begin;

create or replace function public.reject_published_knowledge_version_mutation()
returns trigger language plpgsql set search_path='' as $$
declare
  v_transition_id uuid;
begin
  if old.status = 'published' then
    if tg_op = 'UPDATE' then
      begin
        v_transition_id := nullif(current_setting('app.knowledge_processing_transition_id',true),'')::uuid;
      exception when invalid_text_representation then
        v_transition_id := null;
      end;

      if v_transition_id is not null
        and new.id is not distinct from old.id
        and new.public_id is not distinct from old.public_id
        and new.tenant_id is not distinct from old.tenant_id
        and new.organization_id is not distinct from old.organization_id
        and new.document_id is not distinct from old.document_id
        and new.version_number is not distinct from old.version_number
        and new.status is not distinct from old.status
        and new.title is not distinct from old.title
        and new.summary is not distinct from old.summary
        and new.source_file_id is not distinct from old.source_file_id
        and new.source_sha256 is not distinct from old.source_sha256
        and new.created_by_member_id is not distinct from old.created_by_member_id
        and new.published_by_member_id is not distinct from old.published_by_member_id
        and new.published_at is not distinct from old.published_at
        and new.created_at is not distinct from old.created_at
        and new.updated_at is not distinct from old.updated_at
        and exists (
          select 1
          from public.knowledge_processing_jobs job
          where job.public_id = v_transition_id
            and job.version_id = old.id
            and job.tenant_id = old.tenant_id
            and job.organization_id = old.organization_id
            and job.state = 'running'
            and job.lease_expires_at >= clock_timestamp()
        ) then
        return new;
      end if;
    end if;

    raise exception 'Published knowledge versions are immutable' using errcode='55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.complete_knowledge_processing_job(p_job_id uuid,p_lease_token uuid,p_success boolean,p_result jsonb default '{}'::jsonb,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.knowledge_processing_jobs%rowtype; v_source bigint; v_digest text; v_chunk jsonb;
begin
  if current_user not in ('postgres','service_role') then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_job from public.knowledge_processing_jobs where public_id=p_job_id and state='running' and lease_token=p_lease_token and lease_expires_at>=clock_timestamp() for update;
  if not found then raise exception 'lease_conflict' using errcode='55000'; end if;
  perform set_config('app.knowledge_processing_transition_id',v_job.public_id::text,true);
  if not p_success then
    update public.knowledge_processing_jobs set state=case when attempts>=5 then 'failed' else 'pending' end,available_at=clock_timestamp()+make_interval(secs=>least(300,attempts*30)),error_code=left(coalesce(p_error_code,'processor_failed'),80),lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=v_job.id;
    update public.knowledge_document_versions set processing_state=case when v_job.attempts>=5 then 'failed' else processing_state end,processing_error_code=left(coalesce(p_error_code,'processor_failed'),80) where id=v_job.version_id;
    perform set_config('app.knowledge_processing_transition_id','',true);
    return jsonb_build_object('completed',false,'retry',v_job.attempts<5);
  end if;
  if v_job.job_type='scan' then
    update public.files set security_state=case when coalesce((p_result->>'clean')::boolean,false) then 'ready' else 'rejected' end,detected_mime_type=left(p_result->>'detectedMimeType',160),scanned_at=clock_timestamp(),scan_error_code=null where id=v_job.file_id;
  elsif v_job.job_type='parse' then
    if length(coalesce(p_result->>'text',''))>5000000 then raise exception 'processor_payload_too_large' using errcode='22023'; end if;
    update public.knowledge_document_versions set extracted_text=coalesce(p_result->>'text',''),processing_state='indexing',processing_error_code=null where id=v_job.version_id;
    delete from public.knowledge_chunks where tenant_id=v_job.tenant_id and version_id=v_job.version_id;
    select id into v_source from public.knowledge_sources where tenant_id=v_job.tenant_id and version_id=v_job.version_id order by id limit 1;
    v_digest:=encode(digest(convert_to(v_job.tenant_id::text||':'||v_job.organization_id::text||':'||v_job.document_id::text,'UTF8'),'sha256'),'hex');
    for v_chunk in select value from jsonb_array_elements(coalesce(p_result->'chunks','[]'::jsonb)) loop
      insert into public.knowledge_chunks(tenant_id,organization_id,document_id,version_id,source_id,ordinal,content,token_count,page_number,character_from,character_to,permission_digest)
      values(v_job.tenant_id,v_job.organization_id,v_job.document_id,v_job.version_id,v_source,(v_chunk->>'ordinal')::integer,v_chunk->>'content',(v_chunk->>'tokenCount')::integer,
        (v_chunk->>'page')::integer,(v_chunk->>'characterFrom')::integer,(v_chunk->>'characterTo')::integer,v_digest);
    end loop;
    insert into public.knowledge_processing_jobs(tenant_id,organization_id,document_id,version_id,file_id,job_type)
    values(v_job.tenant_id,v_job.organization_id,v_job.document_id,v_job.version_id,v_job.file_id,'vector') on conflict do nothing;
  elsif v_job.job_type='vector' then
    for v_chunk in select value from jsonb_array_elements(coalesce(p_result->'chunks','[]'::jsonb)) loop
      update public.knowledge_chunks set embedding=(v_chunk->>'embedding')::extensions.vector,embedding_model=left(p_result->>'model',120)
      where tenant_id=v_job.tenant_id and version_id=v_job.version_id and ordinal=(v_chunk->>'ordinal')::integer and stale_at is null;
    end loop;
    update public.knowledge_document_versions set processing_state='ready',processing_error_code=null,indexed_at=clock_timestamp() where id=v_job.version_id;
  end if;
  update public.knowledge_processing_jobs set state='succeeded',result_summary=jsonb_build_object('completedAt',clock_timestamp()),error_code=null,lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=v_job.id;
  perform set_config('app.knowledge_processing_transition_id','',true);
  return jsonb_build_object('completed',true,'jobType',v_job.job_type);
exception when others then
  perform set_config('app.knowledge_processing_transition_id','',true);
  raise;
end;
$$;

revoke all on function public.reject_published_knowledge_version_mutation() from public,anon,authenticated,service_role;
revoke all on function public.complete_knowledge_processing_job(uuid,uuid,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.complete_knowledge_processing_job(uuid,uuid,boolean,jsonb,text) to service_role;

commit;
