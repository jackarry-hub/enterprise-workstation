alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked', 'member.status_changed',
  'member.role_changed', 'profile.updated', 'roster.imported', 'tenant.bootstrap_owner',
  'enterprise.initialized', 'directory.sync_started', 'directory.sync_completed',
  'directory.sync_failed', 'directory.role_mapped', 'project.created', 'task.created',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed', 'ai.config.updated',
  'organization.department_created', 'organization.department_updated',
  'organization.position_upserted', 'organization.role_assigned', 'organization.command_failed'
));

alter table public.departments add column if not exists version bigint not null default 1;
alter table public.position_templates add column if not exists version bigint not null default 1;
alter table public.organization_members add column if not exists role_version bigint not null default 1;

create table public.organization_command_idempotency (
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  operation text not null check (operation in (
    'create_current_department', 'update_current_department',
    'upsert_current_position', 'assign_current_member_role'
  )),
  idempotency_key uuid not null,
  request_id uuid not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, operation, idempotency_key),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete restrict
);

alter table public.organization_command_idempotency enable row level security;
alter table public.organization_command_idempotency force row level security;
revoke all on table public.organization_command_idempotency from public, anon, authenticated, service_role;

create or replace function public.current_organization_command_context(p_permission text)
returns table (tenant_id bigint, organization_id bigint, actor_member_id bigint, actor_auth_user_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if p_permission not in ('organization.manage', 'role.manage') or (select auth.uid()) is null then
    raise exception 'Organization command permission required' using errcode = '42501';
  end if;
  return query
  select tenant.id, organization.id, member.id, (select auth.uid())
  from public.external_identities external
  join public.identity_providers provider on provider.tenant_id = external.tenant_id
    and provider.id = external.identity_provider_id and provider.status = 'active'
  join public.tenants tenant on tenant.id = external.tenant_id and tenant.status = 'active'
  join public.organizations organization on organization.tenant_id = external.tenant_id
    and organization.id = external.organization_id
  join public.organization_members member on member.tenant_id = external.tenant_id
    and member.organization_id = external.organization_id and member.id = external.organization_member_id
    and member.status = 'active'
  join public.employee_profiles profile on profile.tenant_id = member.tenant_id
    and profile.organization_id = member.organization_id and profile.organization_member_id = member.id
    and profile.deleted_at is null and profile.employment_status in ('probation', 'active', 'on_leave')
  where external.auth_user_id = (select auth.uid()) and external.status = 'active'
    and exists (
      select 1 from public.member_roles assignment
      join public.roles role on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
      join public.role_permissions grant_row on grant_row.tenant_id = assignment.tenant_id
        and grant_row.role_id = assignment.role_id
      join public.permissions permission on permission.id = grant_row.permission_id
      where assignment.tenant_id = member.tenant_id and assignment.member_id = member.id
        and role.is_enabled and (role.organization_id is null or role.organization_id = member.organization_id)
        and (not public.is_canonical_workspace_role_code(role.code)
          or (role.is_system and role.organization_id is null))
        and permission.code = p_permission
    ) limit 1;
  if not found then raise exception 'Organization command permission required' using errcode = '42501'; end if;
end;
$$;

create or replace function public.complete_organization_command(
  p_tenant_id bigint, p_organization_id bigint, p_actor_auth_user_id uuid, p_actor_member_id bigint,
  p_operation text, p_success_action text, p_target_type text, p_target_id text,
  p_request_id uuid, p_idempotency_key uuid, p_permission text, p_reason text,
  p_outcome text, p_error text, p_before jsonb, p_after jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  v_result := case when p_outcome = 'success' then jsonb_build_object(
    'outcome', 'success', 'id', p_target_id, 'version', coalesce(p_after -> 'version', 'null'::jsonb)
  ) else jsonb_build_object('outcome', 'failure', 'error', p_error) end;
  update public.organization_command_idempotency
  set result = v_result
  where tenant_id = p_tenant_id and organization_id = p_organization_id
    and operation = p_operation and idempotency_key = p_idempotency_key;
  perform public.append_audit_log(
    p_tenant_id, p_organization_id, p_actor_auth_user_id, p_actor_member_id,
    case when p_outcome = 'success' then p_success_action else 'organization.command_failed' end,
    p_target_type, p_target_id, p_request_id, null,
    jsonb_build_object(
      'outcome', p_outcome, 'requestId', p_request_id, 'idempotencyKey', p_idempotency_key,
      'permissionScope', p_permission, 'businessReason', p_reason,
      'before', coalesce(p_before, 'null'::jsonb), 'after', coalesce(p_after, 'null'::jsonb),
      'failure', case when p_outcome = 'failure' then p_error else null end
    )
  );
  return v_result;
end;
$$;

create or replace function public.audit_organization_command_scope_conflict(
  p_tenant_id bigint, p_organization_id bigint, p_actor_auth_user_id uuid, p_actor_member_id bigint,
  p_operation text, p_target_type text, p_request_id uuid, p_idempotency_key uuid, p_permission text, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.append_audit_log(
    p_tenant_id, p_organization_id, p_actor_auth_user_id, p_actor_member_id,
    'organization.command_failed', p_target_type, null, p_request_id, null,
    jsonb_build_object(
      'outcome', 'failure', 'requestId', p_request_id, 'idempotencyKey', p_idempotency_key,
      'permissionScope', p_permission, 'businessReason', p_reason,
      'before', 'null'::jsonb, 'after', 'null'::jsonb, 'failure', 'scope_conflict'
    )
  );
  return jsonb_build_object('outcome', 'failure', 'error', 'scope_conflict');
end;
$$;

create or replace function public.create_current_department(
  p_label text, p_name text, p_description text, p_sort_order integer, p_version bigint,
  p_reason text, request_id uuid, idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_claimed boolean;
  v_key uuid := idempotency_key; v_existing_org bigint; v_existing jsonb; v_department public.departments%rowtype; v_after jsonb;
begin
  select * into v_tenant, v_org, v_actor, v_user from public.current_organization_command_context('organization.manage');
  if request_id is null or idempotency_key is null or request_id = idempotency_key
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or p_version <> 0 or p_label is null or p_label <> upper(btrim(p_label)) or length(p_label) not between 1 and 80
     or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_description is null
     or length(p_description) > 1000 or p_sort_order is null or p_sort_order < 0 then
    raise exception 'Department command is invalid' using errcode = '22023';
  end if;
  insert into public.organization_command_idempotency (tenant_id, organization_id, operation, idempotency_key, request_id)
  values (v_tenant, v_org, 'create_current_department', idempotency_key, request_id)
  on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed, false) then
    select organization_id, result into v_existing_org, v_existing from public.organization_command_idempotency
    where public.organization_command_idempotency.tenant_id = v_tenant
      and public.organization_command_idempotency.operation = 'create_current_department'
       and public.organization_command_idempotency.idempotency_key = v_key;
    if v_existing_org is distinct from v_org then
      return public.audit_organization_command_scope_conflict(v_tenant, v_org, v_user, v_actor,
        'create_current_department', 'department', request_id, idempotency_key, 'organization.manage', btrim(p_reason));
    end if;
    return v_existing;
  end if;
  begin
    insert into public.departments (tenant_id, organization_id, code, name, description, sort_order, version)
    values (v_tenant, v_org, p_label, btrim(p_name), btrim(p_description), p_sort_order, 1)
    returning * into v_department;
  exception when unique_violation then
    return public.complete_organization_command(v_tenant, v_org, v_user, v_actor,
      'create_current_department', 'organization.department_created', 'department', null,
      request_id, idempotency_key, 'organization.manage', btrim(p_reason), 'failure', 'conflict', null, null);
  end;
  v_after := jsonb_build_object('departmentRef', v_department.public_id, 'departmentLabel', v_department.code,
    'name', v_department.name, 'version', v_department.version);
  return public.complete_organization_command(v_tenant, v_org, v_user, v_actor,
    'create_current_department', 'organization.department_created', 'department', v_department.public_id::text,
    request_id, idempotency_key, 'organization.manage', btrim(p_reason), 'success', null, null, v_after);
end;
$$;

create or replace function public.update_current_department(
  p_department_public_id uuid, p_name text, p_description text, p_sort_order integer, p_version bigint,
  p_reason text, request_id uuid, idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_claimed boolean; v_existing_org bigint; v_existing jsonb;
  v_key uuid := idempotency_key; v_department public.departments%rowtype; v_before jsonb; v_after jsonb;
begin
  select * into v_tenant, v_org, v_actor, v_user from public.current_organization_command_context('organization.manage');
  if request_id is null or idempotency_key is null or request_id = idempotency_key or p_reason is null
     or length(btrim(p_reason)) not between 1 and 500 or p_department_public_id is null or p_version is null
     or p_version < 1 or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_description is null
     or length(p_description) > 1000 or p_sort_order is null or p_sort_order < 0 then raise exception 'Department command is invalid' using errcode = '22023'; end if;
  insert into public.organization_command_idempotency (tenant_id, organization_id, operation, idempotency_key, request_id)
  values (v_tenant, v_org, 'update_current_department', idempotency_key, request_id) on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed, false) then select organization_id, result into v_existing_org, v_existing from public.organization_command_idempotency
    where public.organization_command_idempotency.tenant_id = v_tenant
      and public.organization_command_idempotency.operation = 'update_current_department'
       and public.organization_command_idempotency.idempotency_key = v_key;
    if v_existing_org is distinct from v_org then return public.audit_organization_command_scope_conflict(v_tenant,v_org,v_user,v_actor,'update_current_department','department',request_id,idempotency_key,'organization.manage',btrim(p_reason)); end if;
    return v_existing; end if;
  select * into v_department from public.departments department where department.tenant_id = v_tenant
    and department.organization_id = v_org and department.public_id = p_department_public_id and department.deleted_at is null for update;
  if not found then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'update_current_department','organization.department_updated','department',p_department_public_id::text,request_id,idempotency_key,'organization.manage',btrim(p_reason),'failure','not_found',null,null); end if;
  if exists (select 1 from public.directory_entity_links link where link.tenant_id=v_tenant and link.organization_id=v_org and link.entity_type='department' and link.department_id=v_department.id) then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'update_current_department','organization.department_updated','department',v_department.public_id::text,request_id,idempotency_key,'organization.manage',btrim(p_reason),'failure','forbidden',null,null); end if;
  if v_department.version <> p_version then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'update_current_department','organization.department_updated','department',v_department.public_id::text,request_id,idempotency_key,'organization.manage',btrim(p_reason),'failure','stale_version',null,null); end if;
  v_before := jsonb_build_object('departmentRef',v_department.public_id,'name',v_department.name,'version',v_department.version);
  update public.departments set name=btrim(p_name),description=btrim(p_description),sort_order=p_sort_order,version=version+1,updated_at=clock_timestamp() where id=v_department.id returning * into v_department;
  v_after := jsonb_build_object('departmentRef',v_department.public_id,'name',v_department.name,'version',v_department.version);
  return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'update_current_department','organization.department_updated','department',v_department.public_id::text,request_id,idempotency_key,'organization.manage',btrim(p_reason),'success',null,v_before,v_after);
end;
$$;

create or replace function public.upsert_current_position(
  p_position_public_id uuid, p_label text, p_name text, p_category text, p_description text,
  p_department_public_id uuid, p_version bigint, p_reason text, request_id uuid, idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_claimed boolean; v_existing_org bigint; v_existing jsonb;
  v_key uuid := idempotency_key; v_department_id bigint; v_position public.position_templates%rowtype; v_before jsonb; v_after jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user from public.current_organization_command_context('organization.manage');
  if request_id is null or idempotency_key is null or request_id=idempotency_key or p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_label is null or p_label<>upper(btrim(p_label)) or length(p_label) not between 1 and 80 or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_category is null or length(btrim(p_category)) not between 1 and 80 or p_description is null or length(p_description)>1000 or p_version is null or p_version<0 then raise exception 'Position command is invalid' using errcode='22023'; end if;
  insert into public.organization_command_idempotency (tenant_id,organization_id,operation,idempotency_key,request_id) values (v_tenant,v_org,'upsert_current_position',idempotency_key,request_id) on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed,false) then select organization_id, result into v_existing_org, v_existing from public.organization_command_idempotency
    where public.organization_command_idempotency.tenant_id=v_tenant
      and public.organization_command_idempotency.operation='upsert_current_position'
       and public.organization_command_idempotency.idempotency_key=v_key;
    if v_existing_org is distinct from v_org then return public.audit_organization_command_scope_conflict(v_tenant,v_org,v_user,v_actor,'upsert_current_position','position',request_id,idempotency_key,'organization.manage',btrim(p_reason)); end if;
    return v_existing; end if;
  if p_department_public_id is not null then select id into v_department_id from public.departments where tenant_id=v_tenant and organization_id=v_org and public_id=p_department_public_id and deleted_at is null; if v_department_id is null then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'upsert_current_position','organization.position_upserted','position',p_department_public_id::text,request_id,idempotency_key,'organization.manage',btrim(p_reason),'failure','not_found',null,null); end if; end if;
  if p_position_public_id is null then
    if p_version<>0 then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'upsert_current_position','organization.position_upserted','position',null,request_id,idempotency_key,'organization.manage',btrim(p_reason),'failure','stale_version',null,null); end if;
    begin insert into public.position_templates (tenant_id,organization_id,department_id,code,name,category,description,source,status,version) values (v_tenant,v_org,v_department_id,p_label,btrim(p_name),btrim(p_category),btrim(p_description),'manual','active',1) returning * into v_position;
    exception when unique_violation then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'upsert_current_position','organization.position_upserted','position',null,request_id,idempotency_key,'organization.manage',btrim(p_reason),'failure','conflict',null,null); end;
    v_before:=null;
  else
    select * into v_position from public.position_templates where tenant_id=v_tenant and organization_id=v_org and public_id=p_position_public_id and deleted_at is null for update;
    if not found then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'upsert_current_position','organization.position_upserted','position',p_position_public_id::text,request_id,idempotency_key,'organization.manage',btrim(p_reason),'failure','not_found',null,null); end if;
    if v_position.source<>'manual' or exists (select 1 from public.directory_entity_links link where link.tenant_id=v_tenant and link.organization_id=v_org and link.entity_type='position' and link.position_template_id=v_position.id) then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'upsert_current_position','organization.position_upserted','position',v_position.public_id::text,request_id,idempotency_key,'organization.manage',btrim(p_reason),'failure','forbidden',null,null); end if;
    if v_position.version<>p_version then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'upsert_current_position','organization.position_upserted','position',v_position.public_id::text,request_id,idempotency_key,'organization.manage',btrim(p_reason),'failure','stale_version',null,null); end if;
    v_before:=jsonb_build_object('positionRef',v_position.public_id,'name',v_position.name,'version',v_position.version);
    begin
      update public.position_templates set department_id=v_department_id,code=p_label,name=btrim(p_name),category=btrim(p_category),description=btrim(p_description),version=version+1,updated_at=clock_timestamp() where id=v_position.id returning * into v_position;
    exception when unique_violation then
      return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'upsert_current_position','organization.position_upserted','position',v_position.public_id::text,request_id,idempotency_key,'organization.manage',btrim(p_reason),'failure','conflict',v_before,null);
    end;
  end if;
  v_after:=jsonb_build_object('positionRef',v_position.public_id,'positionLabel',v_position.code,'name',v_position.name,'version',v_position.version);
  return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'upsert_current_position','organization.position_upserted','position',v_position.public_id::text,request_id,idempotency_key,'organization.manage',btrim(p_reason),'success',null,v_before,v_after);
end;
$$;

create or replace function public.assign_current_member_role(
  p_member_id bigint, p_role_name text, p_version bigint, p_reason text, request_id uuid, idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_claimed boolean; v_existing_org bigint; v_existing jsonb;
  v_key uuid := idempotency_key; v_target public.organization_members%rowtype; v_role_id bigint; v_before jsonb; v_after jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user from public.current_organization_command_context('role.manage');
  if request_id is null or idempotency_key is null or request_id=idempotency_key or p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_member_id is null or p_version is null or p_version<1 or p_role_name not in ('admin','department_head','employee','finance','hr') then raise exception 'Role command is invalid' using errcode='22023'; end if;
  insert into public.organization_command_idempotency (tenant_id,organization_id,operation,idempotency_key,request_id) values (v_tenant,v_org,'assign_current_member_role',idempotency_key,request_id) on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed,false) then select organization_id, result into v_existing_org, v_existing from public.organization_command_idempotency
    where public.organization_command_idempotency.tenant_id=v_tenant
      and public.organization_command_idempotency.operation='assign_current_member_role'
       and public.organization_command_idempotency.idempotency_key=v_key;
    if v_existing_org is distinct from v_org then return public.audit_organization_command_scope_conflict(v_tenant,v_org,v_user,v_actor,'assign_current_member_role','organization_member',request_id,idempotency_key,'role.manage',btrim(p_reason)); end if;
    return v_existing; end if;
  select * into v_target from public.organization_members where tenant_id=v_tenant and organization_id=v_org and id=p_member_id and status in ('active','invited') for update;
  if not found then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'assign_current_member_role','organization.role_assigned','organization_member',p_member_id::text,request_id,idempotency_key,'role.manage',btrim(p_reason),'failure','not_found',null,null); end if;
  if exists (select 1 from public.member_roles assignment where assignment.tenant_id=v_tenant and assignment.member_id=v_target.id and assignment.assignment_source='directory') then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'assign_current_member_role','organization.role_assigned','organization_member',v_target.id::text,request_id,idempotency_key,'role.manage',btrim(p_reason),'failure','directory_role_owned',null,null); end if;
  if exists (select 1 from public.member_roles assignment join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id where assignment.tenant_id=v_tenant and assignment.member_id=v_target.id and role.code='owner') then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'assign_current_member_role','organization.role_assigned','organization_member',v_target.id::text,request_id,idempotency_key,'role.manage',btrim(p_reason),'failure','forbidden',null,null); end if;
  if v_target.role_version<>p_version then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'assign_current_member_role','organization.role_assigned','organization_member',v_target.id::text,request_id,idempotency_key,'role.manage',btrim(p_reason),'failure','stale_version',null,null); end if;
  select id into v_role_id from public.roles where tenant_id=v_tenant and organization_id is null and code=p_role_name and is_system and is_enabled limit 1;
  if v_role_id is null then return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'assign_current_member_role','organization.role_assigned','organization_member',v_target.id::text,request_id,idempotency_key,'role.manage',btrim(p_reason),'failure','not_found',null,null); end if;
  select coalesce(jsonb_agg(role.name order by role.name),'[]'::jsonb) into v_before from public.member_roles assignment join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id where assignment.tenant_id=v_tenant and assignment.member_id=v_target.id;
  delete from public.member_roles assignment where assignment.tenant_id=v_tenant and assignment.member_id=v_target.id and assignment.assignment_source='manual';
  insert into public.member_roles (tenant_id,member_id,role_id,assignment_source) values (v_tenant,v_target.id,v_role_id,'manual') on conflict (tenant_id,member_id,role_id) do nothing;
  update public.organization_members set role_version=role_version+1 where id=v_target.id returning * into v_target;
  select coalesce(jsonb_agg(role.name order by role.name),'[]'::jsonb) into v_after from public.member_roles assignment join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id where assignment.tenant_id=v_tenant and assignment.member_id=v_target.id;
  return public.complete_organization_command(v_tenant,v_org,v_user,v_actor,'assign_current_member_role','organization.role_assigned','organization_member',v_target.id::text,request_id,idempotency_key,'role.manage',btrim(p_reason),'success',null,jsonb_build_object('roleSet',v_before,'version',p_version),jsonb_build_object('roleSet',v_after,'version',v_target.role_version));
end;
$$;

revoke all on function public.current_organization_command_context(text) from public, anon, authenticated, service_role;
revoke all on function public.complete_organization_command(bigint,bigint,uuid,bigint,text,text,text,text,uuid,uuid,text,text,text,text,jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.audit_organization_command_scope_conflict(bigint,bigint,uuid,bigint,text,text,uuid,uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function public.create_current_department(text,text,text,integer,bigint,text,uuid,uuid) from public, anon;
revoke all on function public.update_current_department(uuid,text,text,integer,bigint,text,uuid,uuid) from public, anon;
revoke all on function public.upsert_current_position(uuid,text,text,text,text,uuid,bigint,text,uuid,uuid) from public, anon;
revoke all on function public.assign_current_member_role(bigint,text,bigint,text,uuid,uuid) from public, anon;
grant execute on function public.create_current_department(text,text,text,integer,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.update_current_department(uuid,text,text,integer,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.upsert_current_position(uuid,text,text,text,text,uuid,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.assign_current_member_role(bigint,text,bigint,text,uuid,uuid) to authenticated;
