begin;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned','identity.claimed','identity.revoked','member.status_changed','member.role_changed','profile.updated','roster.imported','tenant.bootstrap_owner',
  'enterprise.initialized','directory.sync_started','directory.sync_completed','directory.sync_failed','directory.role_mapped','project.created','project.updated',
  'project.archived','project.restored','project.member_added','project.member_role_changed','project.member_removed','project.command_failed','project.milestone_created',
  'project.risk_created','project.activity_recorded','project.report_submitted','project.execution_failed','task.created','task.batch_created','task.claimed',
  'task.progress_updated','task.submitted','task.reviewed','task.reopened','task.acceptance_recorded','task.command_failed','task.comment_created','task.dependency_created',
  'notification.read','notification.retried','file.upload_reserved','file.upload_completed','file.upload_failed','file.upload_expired','file.download_authorized',
  'customer.created','customer.updated','customer.contact_created','customer.command_failed','customer.owner_transferred','customer.archived','customer.restored',
  'customer.contract_created','customer.source_linked','customer.import_started','customer.imported','customer.import_completed','customer.export_requested','customer.export_downloaded',
  'opportunity.created','opportunity.stage_changed','opportunity.converted','customer.follow_up_created','approval.submitted','approval.step_approved','approval.approved',
  'approval.rejected','approval.returned','approval.cancelled','approval.command_failed','expense.draft_created','expense.draft_updated','expense.submitted','expense.cancelled',
  'expense.paid','expense.command_failed','knowledge.directory_created','knowledge.draft_created','knowledge.version_created','knowledge.published','knowledge.archived',
  'knowledge.permission_changed','knowledge.command_failed','knowledge.searched','knowledge.source_downloaded','knowledge.reindexed',
  'payroll_policy.activated','payroll.calculated','payroll.confirmed','ai.config.updated','organization.department_created','organization.department_updated',
  'organization.position_upserted','organization.role_assigned','organization.command_failed','organization.manager_assigned','directory.manager_mapped',
  'employee_skill.verified','employee_skill.verification_failed','directory.sync_issue_resolved'
));

create table public.knowledge_command_receipts (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  actor_member_id bigint not null,
  idempotency_key uuid not null,
  command text not null check (command in ('create_directory','create_draft','add_version','publish','archive','grant_access')),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  request_id uuid not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id,actor_member_id,idempotency_key),
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete restrict,
  foreign key (tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete restrict
);

alter table public.knowledge_command_receipts enable row level security;
alter table public.knowledge_command_receipts force row level security;

create or replace function public.execute_knowledge_command(
  p_command text,p_payload jsonb,p_idempotency_key uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_tenant bigint;
  v_org bigint;
  v_actor bigint;
  v_user uuid := auth.uid();
  v_digest text;
  v_receipt public.knowledge_command_receipts%rowtype;
  v_directory public.knowledge_directories%rowtype;
  v_document public.knowledge_documents%rowtype;
  v_version public.knowledge_document_versions%rowtype;
  v_file public.files%rowtype;
  v_parent bigint;
  v_directory_id bigint;
  v_document_id bigint;
  v_file_id bigint;
  v_tags text[];
  v_title text;
  v_summary text;
  v_category text;
  v_result jsonb;
  v_action text;
  v_target_type text;
  v_target_id text;
begin
  if v_user is null or p_idempotency_key is null or p_request_id is null
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_command not in ('create_directory','create_draft','add_version','publish','archive','grant_access') then
    raise exception 'invalid_request' using errcode='22023';
  end if;

  v_org := public.active_workspace_organization_id(v_user);
  select member.tenant_id,member.id into v_tenant,v_actor
  from public.organization_members member
  where member.organization_id=v_org and member.user_id=v_user and member.status='active'
  for share;
  if not found then raise exception 'forbidden' using errcode='42501'; end if;

  v_digest := encode(digest(convert_to(p_command || ':' || p_payload::text,'UTF8'),'sha256'),'hex');
  insert into public.knowledge_command_receipts(
    tenant_id,organization_id,actor_member_id,idempotency_key,command,payload_digest,request_id
  ) values (v_tenant,v_org,v_actor,p_idempotency_key,p_command,v_digest,p_request_id)
  on conflict (tenant_id,actor_member_id,idempotency_key) do nothing;

  select * into v_receipt from public.knowledge_command_receipts receipt
  where receipt.tenant_id=v_tenant and receipt.actor_member_id=v_actor
    and receipt.idempotency_key=p_idempotency_key for update;
  if v_receipt.command<>p_command or v_receipt.payload_digest<>v_digest then
    raise exception 'idempotency_conflict' using errcode='23505';
  end if;
  if v_receipt.result is not null then return v_receipt.result; end if;

  if p_command='create_directory' then
    if not public.has_organization_permission(v_org,'knowledge.manage') then
      raise exception 'forbidden' using errcode='42501';
    end if;
    if p_payload ? 'parentId' and p_payload->>'parentId'<>'' then
      select id into v_parent from public.knowledge_directories
      where tenant_id=v_tenant and organization_id=v_org and public_id=(p_payload->>'parentId')::uuid and archived_at is null;
      if not found then raise exception 'not_found' using errcode='P0002'; end if;
    end if;
    insert into public.knowledge_directories(tenant_id,organization_id,parent_id,name,slug,created_by_member_id)
    values(v_tenant,v_org,v_parent,btrim(p_payload->>'name'),lower(btrim(p_payload->>'slug')),v_actor)
    returning * into v_directory;
    v_result:=jsonb_build_object('outcome','success','command',p_command,'resource','knowledge_directory','directory',jsonb_build_object(
      'id',v_directory.public_id,'name',v_directory.name,'slug',v_directory.slug));
    v_action:='knowledge.directory_created'; v_target_type:='knowledge_directory'; v_target_id:=v_directory.public_id::text;

  elsif p_command in ('create_draft','add_version') then
    v_title:=btrim(p_payload->>'title'); v_summary:=coalesce(btrim(p_payload->>'summary'),'');
    v_category:=coalesce(nullif(btrim(p_payload->>'category'),''),'未分类');
    if length(v_title) not between 1 and 200 or length(v_summary)>2000 or length(v_category)>80 then
      raise exception 'invalid_request' using errcode='22023';
    end if;
    select coalesce(array_agg(value order by value),'{}'::text[]) into v_tags
    from (select distinct btrim(value) value from jsonb_array_elements_text(coalesce(p_payload->'tags','[]'::jsonb)) where length(btrim(value)) between 1 and 40 limit 20) tags;
    if p_payload ? 'directoryId' and p_payload->>'directoryId'<>'' then
      select id into v_directory_id from public.knowledge_directories
      where tenant_id=v_tenant and organization_id=v_org and public_id=(p_payload->>'directoryId')::uuid and archived_at is null;
      if not found then raise exception 'not_found' using errcode='P0002'; end if;
    end if;
    select * into v_file from public.files file
    where file.tenant_id=v_tenant and file.organization_id=v_org
      and file.public_id=(p_payload->>'fileId')::uuid and file.deleted_at is null and file.verified_at is not null
      and file.sha256 is not null and (file.uploaded_by_member_id=v_actor or public.has_organization_permission(v_org,'knowledge.manage'))
    for share;
    if not found then raise exception 'unverified_file' using errcode='22023'; end if;
    v_file_id:=v_file.id;

    if p_command='create_draft' then
      insert into public.knowledge_documents(tenant_id,organization_id,created_by_member_id,owner_member_id,title,summary,category,tags,status,version,directory_id)
      values(v_tenant,v_org,v_actor,v_actor,v_title,v_summary,v_category,v_tags,'draft',1,v_directory_id)
      returning * into v_document;
    else
      select * into v_document from public.knowledge_documents document
      where document.tenant_id=v_tenant and document.organization_id=v_org
        and document.public_id=(p_payload->>'documentId')::uuid and document.archived_at is null for update;
      if not found then raise exception 'not_found' using errcode='P0002'; end if;
      if v_document.owner_member_id<>v_actor and not public.has_organization_permission(v_org,'knowledge.manage') then
        raise exception 'forbidden' using errcode='42501';
      end if;
    end if;

    insert into public.knowledge_document_versions(
      tenant_id,organization_id,document_id,version_number,status,title,summary,source_file_id,source_sha256,created_by_member_id
    ) values(
      v_tenant,v_org,v_document.id,
      coalesce((select max(version_number)+1 from public.knowledge_document_versions where tenant_id=v_tenant and document_id=v_document.id),1),
      'draft',v_title,v_summary,v_file_id,v_file.sha256,v_actor
    ) returning * into v_version;
    insert into public.knowledge_sources(tenant_id,organization_id,document_id,version_id,file_id)
    values(v_tenant,v_org,v_document.id,v_version.id,v_file_id);
    update public.knowledge_documents set version=v_version.version_number,title=v_title,summary=v_summary,category=v_category,tags=v_tags,updated_at=clock_timestamp()
    where id=v_document.id;
    v_result:=jsonb_build_object('outcome','success','command',p_command,'resource','knowledge_document','document',jsonb_build_object(
      'id',v_document.public_id,'versionId',v_version.public_id,'version',v_version.version_number,'status','draft'));
    v_action:=case when p_command='create_draft' then 'knowledge.draft_created' else 'knowledge.version_created' end;
    v_target_type:='knowledge_document'; v_target_id:=v_document.public_id::text;

  elsif p_command='publish' then
    if not public.has_organization_permission(v_org,'knowledge.manage') then raise exception 'forbidden' using errcode='42501'; end if;
    select * into v_document from public.knowledge_documents document
    where document.tenant_id=v_tenant and document.organization_id=v_org
      and document.public_id=(p_payload->>'documentId')::uuid and document.archived_at is null for update;
    if not found then raise exception 'not_found' using errcode='P0002'; end if;
    select * into v_version from public.knowledge_document_versions version
    where version.tenant_id=v_tenant and version.organization_id=v_org and version.document_id=v_document.id
      and version.public_id=(p_payload->>'versionId')::uuid and version.status='draft' for update;
    if not found then raise exception 'version_conflict' using errcode='55000'; end if;
    update public.knowledge_document_versions set status='published',published_by_member_id=v_actor,published_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=v_version.id returning * into v_version;
    update public.knowledge_documents set current_version_id=v_version.id,status='published',published_at=v_version.published_at,version=v_version.version_number,updated_at=clock_timestamp()
    where id=v_document.id;
    v_result:=jsonb_build_object('outcome','success','command',p_command,'resource','knowledge_document','document',jsonb_build_object(
      'id',v_document.public_id,'versionId',v_version.public_id,'version',v_version.version_number,'status','published'));
    v_action:='knowledge.published'; v_target_type:='knowledge_document'; v_target_id:=v_document.public_id::text;

  elsif p_command='archive' then
    select * into v_document from public.knowledge_documents document
    where document.tenant_id=v_tenant and document.organization_id=v_org and document.public_id=(p_payload->>'documentId')::uuid and document.archived_at is null for update;
    if not found then raise exception 'not_found' using errcode='P0002'; end if;
    if v_document.owner_member_id<>v_actor and not public.has_organization_permission(v_org,'knowledge.manage') then raise exception 'forbidden' using errcode='42501'; end if;
    update public.knowledge_documents set status='archived',archived_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_document.id;
    v_result:=jsonb_build_object('outcome','success','command',p_command,'resource','knowledge_document','document',jsonb_build_object('id',v_document.public_id,'status','archived'));
    v_action:='knowledge.archived'; v_target_type:='knowledge_document'; v_target_id:=v_document.public_id::text;

  else
    if not public.has_organization_permission(v_org,'knowledge.manage') then raise exception 'forbidden' using errcode='42501'; end if;
    select id into v_document_id from public.knowledge_documents where tenant_id=v_tenant and organization_id=v_org and public_id=(p_payload->>'documentId')::uuid;
    if not found then raise exception 'not_found' using errcode='P0002'; end if;
    insert into public.knowledge_permissions(tenant_id,organization_id,document_id,subject_type,subject_id,permission,granted_by_member_id)
    values(v_tenant,v_org,v_document_id,p_payload->>'subjectType',(p_payload->>'subjectId')::bigint,coalesce(p_payload->>'permission','read'),v_actor)
    on conflict (tenant_id,organization_id,document_id,directory_id,subject_type,subject_id,permission) do nothing;
    v_result:=jsonb_build_object('outcome','success','command',p_command,'resource','knowledge_permission','documentId',p_payload->>'documentId');
    v_action:='knowledge.permission_changed'; v_target_type:='knowledge_document'; v_target_id:=p_payload->>'documentId';
  end if;

  perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,v_action,v_target_type,v_target_id,p_request_id,null,jsonb_build_object('command',p_command));
  update public.knowledge_command_receipts set result=v_result where id=v_receipt.id;
  return v_result;
exception when others then
  if v_tenant is not null and v_actor is not null then
    perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'knowledge.command_failed','knowledge_command',p_command,p_request_id,null,
      jsonb_build_object('command',p_command,'sqlstate',sqlstate));
  end if;
  raise;
end;
$$;

revoke all on table public.knowledge_command_receipts from public,anon,authenticated;
revoke all on function public.execute_knowledge_command(text,jsonb,uuid,uuid) from public,anon;
grant execute on function public.execute_knowledge_command(text,jsonb,uuid,uuid) to authenticated;

commit;
