begin;

create extension if not exists vector with schema extensions;

insert into public.permissions(code,name,module,action) values('knowledge.read','查看知识库','knowledge','read')
on conflict(code) do update set name=excluded.name,module=excluded.module,action=excluded.action;

create or replace function public.is_knowledge_reader_baseline_role(p_is_system boolean,p_is_enabled boolean,p_organization_id bigint,p_code text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_is_system,false) and coalesce(p_is_enabled,false) and p_organization_id is null
    and p_code in ('owner','admin','department_head','supervisor','employee','finance','hr');
$$;
create or replace function public.grant_knowledge_read_after_role_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.is_knowledge_reader_baseline_role(new.is_system,new.is_enabled,new.organization_id,new.code) then
    insert into public.role_permissions(tenant_id,role_id,permission_id)
    select new.tenant_id,new.id,permission.id from public.permissions permission where permission.code='knowledge.read' on conflict do nothing;
  end if;
  return new;
end;
$$;
create or replace function public.revoke_knowledge_read_before_role_update()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.is_knowledge_reader_baseline_role(old.is_system,old.is_enabled,old.organization_id,old.code) then
    delete from public.role_permissions assignment using public.permissions permission
    where assignment.tenant_id=old.tenant_id and assignment.role_id=old.id and assignment.permission_id=permission.id and permission.code='knowledge.read';
  end if;
  return new;
end;
$$;
drop trigger if exists roles_knowledge_read_before_update on public.roles;
drop trigger if exists roles_knowledge_read_after_insert on public.roles;
drop trigger if exists roles_knowledge_read_after_update on public.roles;
create trigger roles_knowledge_read_before_update before update of tenant_id,is_system,is_enabled,organization_id,code on public.roles
for each row execute function public.revoke_knowledge_read_before_role_update();
create trigger roles_knowledge_read_after_insert after insert on public.roles for each row execute function public.grant_knowledge_read_after_role_change();
create trigger roles_knowledge_read_after_update after update of tenant_id,is_system,is_enabled,organization_id,code on public.roles
for each row execute function public.grant_knowledge_read_after_role_change();
insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id from public.roles role cross join public.permissions permission
where permission.code='knowledge.read' and public.is_knowledge_reader_baseline_role(role.is_system,role.is_enabled,role.organization_id,role.code)
on conflict do nothing;

alter table public.files
  add column security_state text not null default 'quarantined' check (security_state in ('quarantined','scanning','ready','rejected')),
  add column detected_mime_type text,
  add column scanned_at timestamptz,
  add column scan_error_code text;

update public.files set security_state='ready',scanned_at=verified_at where verified_at is not null;

alter table public.knowledge_document_versions
  add column processing_state text not null default 'pending' check (processing_state in ('pending','parsing','indexing','ready','failed','stale')),
  add column processing_error_code text,
  add column indexed_at timestamptz;

create table public.knowledge_processing_jobs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  document_id bigint not null,
  version_id bigint not null,
  file_id bigint not null,
  job_type text not null check (job_type in ('scan','parse','vector','cleanup')),
  state text not null default 'pending' check (state in ('pending','running','succeeded','failed','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  available_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  result_summary jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id,organization_id,id),
  foreign key (tenant_id,organization_id,document_id) references public.knowledge_documents(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,version_id) references public.knowledge_document_versions(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,file_id) references public.files(tenant_id,organization_id,id) on delete restrict,
  constraint knowledge_job_lease_check check (
    (state='running' and lease_token is not null and lease_expires_at is not null)
    or (state<>'running' and lease_token is null and lease_expires_at is null)
  )
);

create unique index knowledge_processing_one_active_idx
  on public.knowledge_processing_jobs(tenant_id,version_id,job_type)
  where state in ('pending','running');
create index knowledge_processing_claim_idx on public.knowledge_processing_jobs(state,available_at,id)
  where state in ('pending','running');

create table public.knowledge_chunks (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  document_id bigint not null,
  version_id bigint not null,
  source_id bigint not null,
  ordinal integer not null check (ordinal >= 0),
  content text not null check (length(content) between 1 and 12000),
  token_count integer not null check (token_count between 1 and 4000),
  page_number integer check (page_number is null or page_number > 0),
  character_from integer check (character_from is null or character_from >= 0),
  character_to integer check (character_to is null or character_to >= character_from),
  embedding extensions.vector(384),
  embedding_model text,
  permission_digest text not null check (permission_digest ~ '^[0-9a-f]{64}$'),
  stale_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id,version_id,ordinal),
  foreign key (tenant_id,organization_id,document_id) references public.knowledge_documents(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,version_id) references public.knowledge_document_versions(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,source_id) references public.knowledge_sources(tenant_id,organization_id,id) on delete cascade
);

alter table public.knowledge_processing_jobs enable row level security;
alter table public.knowledge_processing_jobs force row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.knowledge_chunks force row level security;
create policy knowledge_jobs_manager_read on public.knowledge_processing_jobs for select to authenticated
  using ((select public.has_organization_permission(organization_id,'knowledge.manage')));
create policy knowledge_chunks_document_access on public.knowledge_chunks for select to authenticated
  using (stale_at is null and public.can_access_knowledge_document(document_id,false));
grant select on public.knowledge_processing_jobs,public.knowledge_chunks to authenticated;

create or replace function public.guard_knowledge_publish_readiness()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='draft' and new.status='published' and not exists (
    select 1 from public.files file where file.tenant_id=new.tenant_id and file.organization_id=new.organization_id
      and file.id=new.source_file_id and file.verified_at is not null and file.security_state='ready'
  ) then raise exception 'source_not_ready' using errcode='22023'; end if;
  return new;
end;
$$;
create trigger knowledge_publish_readiness
before update of status on public.knowledge_document_versions
for each row execute function public.guard_knowledge_publish_readiness();

create or replace function public.enqueue_published_knowledge_processing()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_source public.knowledge_sources%rowtype;
begin
  if old.status='draft' and new.status='published' then
    select * into v_source from public.knowledge_sources where tenant_id=new.tenant_id and version_id=new.id order by id limit 1;
    if found then
      insert into public.knowledge_processing_jobs(tenant_id,organization_id,document_id,version_id,file_id,job_type)
      values(new.tenant_id,new.organization_id,new.document_id,new.id,v_source.file_id,'parse') on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
create trigger knowledge_publish_enqueue
after update of status on public.knowledge_document_versions
for each row execute function public.enqueue_published_knowledge_processing();

create or replace function public.enqueue_knowledge_source_scan()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists (select 1 from public.files file where file.tenant_id=new.tenant_id and file.id=new.file_id and file.security_state<>'ready') then
    insert into public.knowledge_processing_jobs(tenant_id,organization_id,document_id,version_id,file_id,job_type)
    values(new.tenant_id,new.organization_id,new.document_id,new.version_id,new.file_id,'scan') on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger knowledge_source_scan_enqueue after insert on public.knowledge_sources
for each row execute function public.enqueue_knowledge_source_scan();

create or replace function public.cleanup_archived_knowledge_chunks()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    update public.knowledge_chunks set stale_at=clock_timestamp()
    where tenant_id=new.tenant_id and document_id=new.id and stale_at is null;
    update public.knowledge_processing_jobs set state='cancelled',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
    where tenant_id=new.tenant_id and document_id=new.id and state in ('pending','running');
  end if;
  return new;
end;
$$;
create trigger knowledge_archive_cleanup after update of archived_at on public.knowledge_documents
for each row execute function public.cleanup_archived_knowledge_chunks();

alter table public.knowledge_command_receipts drop constraint if exists knowledge_command_receipts_command_check;
alter table public.knowledge_command_receipts add constraint knowledge_command_receipts_command_check
  check (command in ('create_directory','create_draft','add_version','publish','archive','grant_access','reindex'));

create or replace function public.queue_knowledge_reindex(p_document_public_id uuid,p_idempotency_key uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_org bigint; v_tenant bigint; v_actor bigint; v_document public.knowledge_documents%rowtype; v_version public.knowledge_document_versions%rowtype; v_source public.knowledge_sources%rowtype; v_job uuid; v_digest text; v_receipt public.knowledge_command_receipts%rowtype; v_result jsonb;
begin
  if v_user is null or p_document_public_id is null or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  v_org:=public.active_workspace_organization_id(v_user);
  select tenant_id,id into v_tenant,v_actor from public.organization_members where organization_id=v_org and user_id=v_user and status='active';
  if not found or not public.has_organization_permission(v_org,'knowledge.manage') then raise exception 'forbidden' using errcode='42501'; end if;
  v_digest:=encode(digest(convert_to(p_document_public_id::text,'UTF8'),'sha256'),'hex');
  insert into public.knowledge_command_receipts(tenant_id,organization_id,actor_member_id,idempotency_key,command,payload_digest,request_id)
  values(v_tenant,v_org,v_actor,p_idempotency_key,'reindex',v_digest,p_request_id)
  on conflict (tenant_id,actor_member_id,idempotency_key) do nothing;
  select * into v_receipt from public.knowledge_command_receipts where tenant_id=v_tenant and actor_member_id=v_actor and idempotency_key=p_idempotency_key for update;
  if v_receipt.command<>'reindex' or v_receipt.payload_digest<>v_digest then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  if v_receipt.result is not null then return v_receipt.result; end if;
  select * into v_document from public.knowledge_documents where tenant_id=v_tenant and organization_id=v_org and public_id=p_document_public_id and status='published' and archived_at is null for update;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_version from public.knowledge_document_versions where tenant_id=v_tenant and id=v_document.current_version_id for update;
  select * into v_source from public.knowledge_sources where tenant_id=v_tenant and version_id=v_version.id order by id limit 1;
  if not found then raise exception 'source_not_ready' using errcode='22023'; end if;
  update public.knowledge_chunks set stale_at=clock_timestamp() where tenant_id=v_tenant and version_id=v_version.id and stale_at is null;
  update public.knowledge_document_versions set processing_state='pending',processing_error_code=null,indexed_at=null where id=v_version.id;
  insert into public.knowledge_processing_jobs(tenant_id,organization_id,document_id,version_id,file_id,job_type)
  values(v_tenant,v_org,v_document.id,v_version.id,v_source.file_id,'parse')
  on conflict do nothing returning public_id into v_job;
  if v_job is null then select public_id into v_job from public.knowledge_processing_jobs where tenant_id=v_tenant and version_id=v_version.id and job_type='parse' and state in ('pending','running'); end if;
  perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'knowledge.reindexed','knowledge_document',p_document_public_id::text,p_request_id,null,jsonb_build_object('jobId',v_job));
  v_result:=jsonb_build_object('outcome','success','resource','knowledge_processing_job','job',jsonb_build_object('id',v_job,'state','pending'));
  update public.knowledge_command_receipts set result=v_result where id=v_receipt.id;
  return v_result;
end;
$$;

create or replace function public.claim_knowledge_processing_job(p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.knowledge_processing_jobs%rowtype; v_file public.files%rowtype; v_version public.knowledge_document_versions%rowtype; v_source public.knowledge_sources%rowtype; v_token uuid:=gen_random_uuid();
begin
  if current_user not in ('postgres','service_role') or p_lease_seconds not between 30 and 600 then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_job from public.knowledge_processing_jobs job
  where (job.state='pending' and job.available_at<=clock_timestamp()) or (job.state='running' and job.lease_expires_at<clock_timestamp())
  order by job.available_at,job.id for update skip locked limit 1;
  if not found then return jsonb_build_object('acquired',false); end if;
  update public.knowledge_processing_jobs set state='running',attempts=attempts+1,lease_token=v_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp()
  where id=v_job.id returning * into v_job;
  select * into v_file from public.files where tenant_id=v_job.tenant_id and id=v_job.file_id;
  select * into v_version from public.knowledge_document_versions where tenant_id=v_job.tenant_id and id=v_job.version_id;
  select * into v_source from public.knowledge_sources where tenant_id=v_job.tenant_id and version_id=v_job.version_id order by id limit 1;
  return jsonb_build_object('acquired',true,'jobId',v_job.public_id,'leaseToken',v_token,'jobType',v_job.job_type,'attempt',v_job.attempts,
    'documentId',(select public_id from public.knowledge_documents where id=v_job.document_id),'versionId',v_version.public_id,'sourceId',v_source.public_id,
    'file',jsonb_build_object('id',v_file.public_id,'bucket',v_file.bucket,'objectPath',v_file.object_path,'mimeType',v_file.mime_type,'sizeBytes',v_file.size_bytes,'sha256',v_file.sha256),
    'text',case when v_job.job_type='vector' then v_version.extracted_text else null end);
end;
$$;

create or replace function public.complete_knowledge_processing_job(p_job_id uuid,p_lease_token uuid,p_success boolean,p_result jsonb default '{}'::jsonb,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.knowledge_processing_jobs%rowtype; v_source bigint; v_digest text; v_chunk jsonb;
begin
  if current_user not in ('postgres','service_role') then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_job from public.knowledge_processing_jobs where public_id=p_job_id and state='running' and lease_token=p_lease_token and lease_expires_at>=clock_timestamp() for update;
  if not found then raise exception 'lease_conflict' using errcode='55000'; end if;
  if not p_success then
    update public.knowledge_processing_jobs set state=case when attempts>=5 then 'failed' else 'pending' end,available_at=clock_timestamp()+make_interval(secs=>least(300,attempts*30)),error_code=left(coalesce(p_error_code,'processor_failed'),80),lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=v_job.id;
    update public.knowledge_document_versions set processing_state=case when v_job.attempts>=5 then 'failed' else processing_state end,processing_error_code=left(coalesce(p_error_code,'processor_failed'),80) where id=v_job.version_id;
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
  return jsonb_build_object('completed',true,'jobType',v_job.job_type);
end;
$$;

revoke all on function public.guard_knowledge_publish_readiness() from public,anon,authenticated,service_role;
revoke all on function public.is_knowledge_reader_baseline_role(boolean,boolean,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.grant_knowledge_read_after_role_change() from public,anon,authenticated,service_role;
revoke all on function public.revoke_knowledge_read_before_role_update() from public,anon,authenticated,service_role;
revoke all on function public.enqueue_published_knowledge_processing() from public,anon,authenticated,service_role;
revoke all on function public.enqueue_knowledge_source_scan() from public,anon,authenticated,service_role;
revoke all on function public.cleanup_archived_knowledge_chunks() from public,anon,authenticated,service_role;
revoke all on function public.queue_knowledge_reindex(uuid,uuid,uuid) from public,anon;
grant execute on function public.queue_knowledge_reindex(uuid,uuid,uuid) to authenticated;
revoke all on function public.claim_knowledge_processing_job(integer) from public,anon,authenticated;
revoke all on function public.complete_knowledge_processing_job(uuid,uuid,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_knowledge_processing_job(integer) to service_role;
grant execute on function public.complete_knowledge_processing_job(uuid,uuid,boolean,jsonb,text) to service_role;

commit;
