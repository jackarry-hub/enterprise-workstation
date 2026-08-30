begin;

create or replace function public.search_current_knowledge(
  p_query text,p_limit_count integer default 20,p_request_id uuid default gen_random_uuid()
) returns table(
  document_id uuid,version_id uuid,source_id uuid,title text,excerpt text,rank real,updated_at timestamptz
) language plpgsql volatile security definer set search_path='' as $$
declare
  v_tenant bigint;
  v_org bigint;
  v_actor bigint;
  v_user uuid:=auth.uid();
  v_query tsquery;
begin
  if v_user is null or p_request_id is null or length(btrim(coalesce(p_query,''))) not between 1 and 200
     or p_limit_count not between 1 and 50 then raise exception 'invalid_request' using errcode='22023'; end if;
  v_org:=public.active_workspace_organization_id(v_user);
  select member.tenant_id,member.id into v_tenant,v_actor from public.organization_members member
  where member.organization_id=v_org and member.user_id=v_user and member.status='active';
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  v_query:=websearch_to_tsquery('simple',btrim(p_query));
  perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'knowledge.searched','knowledge_search',null,p_request_id,null,
    jsonb_build_object('queryHash',encode(digest(convert_to(lower(btrim(p_query)),'UTF8'),'sha256'),'hex'),'limit',p_limit_count));
  return query
  select document.public_id,version.public_id,source.public_id,version.title,
    left(coalesce(nullif(version.summary,''),nullif(version.extracted_text,''),version.title),500),
    ts_rank_cd(version.search_vector,v_query)::real,version.updated_at
  from public.knowledge_documents document
  join public.knowledge_document_versions version
    on version.tenant_id=document.tenant_id and version.organization_id=document.organization_id
   and version.id=document.current_version_id and version.status='published'
  join lateral (
    select candidate.public_id from public.knowledge_sources candidate
    where candidate.tenant_id=document.tenant_id and candidate.organization_id=document.organization_id
      and candidate.document_id=document.id and candidate.version_id=version.id
    order by candidate.id limit 1
  ) source on true
  where document.tenant_id=v_tenant and document.organization_id=v_org
    and document.status='published' and document.archived_at is null
    and public.can_access_knowledge_document(document.id,false)
    and version.search_vector @@ v_query
  order by ts_rank_cd(version.search_vector,v_query) desc,document.public_id
  limit p_limit_count;
end;
$$;

create or replace function public.authorize_knowledge_source(
  p_document_public_id uuid,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_tenant bigint;
  v_org bigint;
  v_actor bigint;
  v_user uuid:=auth.uid();
  v_result jsonb;
begin
  if v_user is null or p_document_public_id is null or p_request_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  v_org:=public.active_workspace_organization_id(v_user);
  select member.tenant_id,member.id into v_tenant,v_actor from public.organization_members member
  where member.organization_id=v_org and member.user_id=v_user and member.status='active';
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
    'documentId',document.public_id,'versionId',version.public_id,'sourceId',source.public_id,
    'fileId',file.public_id,'bucket',file.bucket,'objectPath',file.object_path,
    'fileName',file.original_name,'mimeType',file.mime_type
  ) into v_result
  from public.knowledge_documents document
  join public.knowledge_document_versions version on version.id=document.current_version_id and version.tenant_id=document.tenant_id
  join public.knowledge_sources source on source.version_id=version.id and source.document_id=document.id and source.tenant_id=document.tenant_id
  join public.files file on file.id=source.file_id and file.tenant_id=source.tenant_id and file.organization_id=source.organization_id
  where document.tenant_id=v_tenant and document.organization_id=v_org and document.public_id=p_document_public_id
    and document.status='published' and document.archived_at is null and version.status='published'
    and file.deleted_at is null and file.verified_at is not null
    and public.can_access_knowledge_document(document.id,false)
  order by source.id limit 1;
  if v_result is null then raise exception 'not_found' using errcode='P0002'; end if;
  perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'knowledge.source_downloaded','knowledge_document',p_document_public_id::text,p_request_id,null,
    jsonb_build_object('versionId',v_result->>'versionId','sourceId',v_result->>'sourceId','fileId',v_result->>'fileId'));
  return v_result;
end;
$$;

revoke all on function public.search_current_knowledge(text,integer,uuid) from public,anon;
revoke all on function public.authorize_knowledge_source(uuid,uuid) from public,anon;
grant execute on function public.search_current_knowledge(text,integer,uuid) to authenticated;
grant execute on function public.authorize_knowledge_source(uuid,uuid) to authenticated;

commit;
