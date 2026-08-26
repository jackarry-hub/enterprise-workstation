alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked',
  'member.status_changed', 'member.role_changed', 'profile.updated',
  'roster.imported', 'tenant.bootstrap_owner', 'enterprise.initialized',
  'directory.sync_started', 'directory.sync_completed', 'directory.sync_failed',
  'directory.role_mapped', 'project.created', 'task.created',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed',
  'ai.config.updated',
  'organization.department_created', 'organization.department_updated',
  'organization.position_upserted', 'organization.role_assigned'
));

alter table public.departments add column if not exists version bigint not null default 1;
alter table public.position_templates add column if not exists version bigint not null default 1;
alter table public.organization_members add column if not exists role_version bigint not null default 1;

create table public.organization_command_idempotency (
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  operation text not null check (operation in (
    'create_current_department', 'update_current_department',
    'upsert_current_position', 'assign_current_member_role'
  )),
  idempotency_key uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, operation, idempotency_key)
);

alter table public.organization_command_idempotency enable row level security;
alter table public.organization_command_idempotency force row level security;
revoke all on table public.organization_command_idempotency from public, anon, authenticated, service_role;

create or replace function public.current_organization_command_context(
  p_permission_code text
)
returns table (
  tenant_id bigint,
  organization_id bigint,
  actor_member_id bigint,
  actor_auth_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_permission_code not in ('organization.manage', 'role.manage') then
    raise exception 'Command permission is invalid' using errcode = '22023';
  end if;
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
  select tenant.id, organization.id, member.id, (select auth.uid())
  from public.external_identities external
  join public.identity_providers provider
    on provider.tenant_id = external.tenant_id
   and provider.id = external.identity_provider_id
   and provider.status = 'active'
  join public.tenants tenant
    on tenant.id = external.tenant_id and tenant.status = 'active'
  join public.organizations organization
    on organization.tenant_id = external.tenant_id and organization.id = external.organization_id
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.organization_id = external.organization_id
   and member.id = external.organization_member_id
   and member.status = 'active'
  join public.employee_profiles profile
    on profile.tenant_id = external.tenant_id
   and profile.organization_id = external.organization_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
   and profile.employment_status in ('probation', 'active', 'on_leave')
  where external.auth_user_id = (select auth.uid())
    and external.status = 'active'
    and exists (
      select 1
      from public.member_roles assignment
      join public.roles role
        on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
      join public.role_permissions role_permission
        on role_permission.tenant_id = assignment.tenant_id and role_permission.role_id = assignment.role_id
      join public.permissions permission on permission.id = role_permission.permission_id
      where assignment.tenant_id = external.tenant_id
        and assignment.member_id = member.id
        and role.is_enabled
        and (role.organization_id is null or role.organization_id = external.organization_id)
        and (
          not public.is_canonical_workspace_role_code(role.code)
          or (role.is_system and role.organization_id is null)
        )
        and permission.code = p_permission_code
    )
  limit 1;

  if not found then
    raise exception 'Organization command permission required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_current_department(
  p_code text,
  p_name text,
  p_description text,
  p_sort_order integer,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_actor_auth_user_id uuid;
  v_department public.departments%rowtype;
begin
  select * into v_tenant_id, v_organization_id, v_actor_member_id, v_actor_auth_user_id
  from public.current_organization_command_context('organization.manage');
  if request_id is null or p_code is null or p_code <> upper(btrim(p_code))
     or length(p_code) not between 1 and 80 or p_name is null or length(btrim(p_name)) not between 1 and 120
     or p_description is null or length(p_description) > 1000 or p_sort_order is null or p_sort_order < 0 then
    raise exception 'Department command is invalid' using errcode = '22023';
  end if;
  insert into public.organization_command_idempotency (tenant_id, operation, idempotency_key)
  values (v_tenant_id, 'create_current_department', request_id);
  insert into public.departments (
    tenant_id, organization_id, code, name, description, sort_order, version
  ) values (
    v_tenant_id, v_organization_id, p_code, btrim(p_name), btrim(p_description), p_sort_order, 1
  ) returning * into v_department;
  perform public.append_audit_log(
    v_tenant_id, v_organization_id, v_actor_auth_user_id, v_actor_member_id,
    'organization.department_created', 'department', v_department.public_id::text, request_id, null,
    jsonb_build_object('after', jsonb_build_object(
      'id', v_department.public_id, 'code', v_department.code, 'name', v_department.name,
      'description', v_department.description, 'sortOrder', v_department.sort_order, 'version', v_department.version
    ), 'idempotencyKey', request_id)
  );
  return jsonb_build_object('id', v_department.public_id, 'version', v_department.version);
end;
$$;

create or replace function public.update_current_department(
  p_department_public_id uuid,
  p_name text,
  p_description text,
  p_sort_order integer,
  p_version bigint,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_actor_auth_user_id uuid;
  v_before jsonb;
  v_department public.departments%rowtype;
begin
  select * into v_tenant_id, v_organization_id, v_actor_member_id, v_actor_auth_user_id
  from public.current_organization_command_context('organization.manage');
  if request_id is null or p_department_public_id is null or p_version is null or p_version < 1
     or p_name is null or length(btrim(p_name)) not between 1 and 120
     or p_description is null or length(p_description) > 1000 or p_sort_order is null or p_sort_order < 0 then
    raise exception 'Department command is invalid' using errcode = '22023';
  end if;
  select * into v_department from public.departments department
  where department.tenant_id = v_tenant_id and department.organization_id = v_organization_id
    and department.public_id = p_department_public_id and department.deleted_at is null
  for update;
  if not found then raise exception 'Organization target not found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.directory_entity_links link
    where link.tenant_id = v_tenant_id and link.organization_id = v_organization_id
      and link.entity_type = 'department' and link.department_id = v_department.id
  ) then raise exception 'Feishu owned department cannot be changed manually' using errcode = '42501'; end if;
  if v_department.version <> p_version then raise exception 'Department version is stale' using errcode = '40001'; end if;
  insert into public.organization_command_idempotency (tenant_id, operation, idempotency_key)
  values (v_tenant_id, 'update_current_department', request_id);
  v_before := jsonb_build_object('id', v_department.public_id, 'name', v_department.name,
    'description', v_department.description, 'sortOrder', v_department.sort_order, 'version', v_department.version);
  update public.departments department set name = btrim(p_name), description = btrim(p_description),
    sort_order = p_sort_order, version = department.version + 1, updated_at = clock_timestamp()
  where department.id = v_department.id returning * into v_department;
  perform public.append_audit_log(
    v_tenant_id, v_organization_id, v_actor_auth_user_id, v_actor_member_id,
    'organization.department_updated', 'department', v_department.public_id::text, request_id, null,
    jsonb_build_object('before', v_before, 'after', jsonb_build_object(
      'id', v_department.public_id, 'name', v_department.name, 'description', v_department.description,
      'sortOrder', v_department.sort_order, 'version', v_department.version
    ), 'idempotencyKey', request_id)
  );
  return jsonb_build_object('id', v_department.public_id, 'version', v_department.version);
end;
$$;

create or replace function public.upsert_current_position(
  p_position_public_id uuid,
  p_code text,
  p_name text,
  p_category text,
  p_description text,
  p_department_public_id uuid,
  p_version bigint,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_actor_auth_user_id uuid;
  v_department_id bigint;
  v_position public.position_templates%rowtype;
  v_before jsonb;
begin
  select * into v_tenant_id, v_organization_id, v_actor_member_id, v_actor_auth_user_id
  from public.current_organization_command_context('organization.manage');
  if request_id is null or p_code is null or p_code <> upper(btrim(p_code)) or length(p_code) not between 1 and 80
     or p_name is null or length(btrim(p_name)) not between 1 and 120
     or p_category is null or length(btrim(p_category)) not between 1 and 80
     or p_description is null or length(p_description) > 1000 or p_version is null or p_version < 0 then
    raise exception 'Position command is invalid' using errcode = '22023';
  end if;
  if p_department_public_id is not null then
    select department.id into v_department_id from public.departments department
    where department.tenant_id = v_tenant_id and department.organization_id = v_organization_id
      and department.public_id = p_department_public_id and department.deleted_at is null;
    if v_department_id is null then raise exception 'Organization target not found' using errcode = 'P0002'; end if;
  end if;
  if p_position_public_id is null then
    if p_version <> 0 then raise exception 'Position version is stale' using errcode = '40001'; end if;
    insert into public.organization_command_idempotency (tenant_id, operation, idempotency_key)
    values (v_tenant_id, 'upsert_current_position', request_id);
    insert into public.position_templates (
      tenant_id, organization_id, department_id, code, name, category, description, source, status, version
    ) values (
      v_tenant_id, v_organization_id, v_department_id, p_code, btrim(p_name), btrim(p_category),
      btrim(p_description), 'manual', 'active', 1
    ) returning * into v_position;
    v_before := null;
  else
    select * into v_position from public.position_templates position
    where position.tenant_id = v_tenant_id and position.organization_id = v_organization_id
      and position.public_id = p_position_public_id and position.deleted_at is null
    for update;
    if not found then raise exception 'Organization target not found' using errcode = 'P0002'; end if;
    if v_position.source <> 'manual' or exists (
      select 1 from public.directory_entity_links link
      where link.tenant_id = v_tenant_id and link.organization_id = v_organization_id
        and link.entity_type = 'position' and link.position_template_id = v_position.id
    ) then raise exception 'Feishu owned position cannot be changed manually' using errcode = '42501'; end if;
    if v_position.version <> p_version then raise exception 'Position version is stale' using errcode = '40001'; end if;
    insert into public.organization_command_idempotency (tenant_id, operation, idempotency_key)
    values (v_tenant_id, 'upsert_current_position', request_id);
    v_before := jsonb_build_object('id', v_position.public_id, 'code', v_position.code, 'name', v_position.name,
      'category', v_position.category, 'departmentId', v_position.department_id, 'version', v_position.version);
    update public.position_templates position set department_id = v_department_id, code = p_code,
      name = btrim(p_name), category = btrim(p_category), description = btrim(p_description),
      version = position.version + 1, updated_at = clock_timestamp()
    where position.id = v_position.id returning * into v_position;
  end if;
  perform public.append_audit_log(
    v_tenant_id, v_organization_id, v_actor_auth_user_id, v_actor_member_id,
    'organization.position_upserted', 'position', v_position.public_id::text, request_id, null,
    jsonb_build_object('before', v_before, 'after', jsonb_build_object(
      'id', v_position.public_id, 'code', v_position.code, 'name', v_position.name,
      'category', v_position.category, 'departmentId', v_position.department_id, 'version', v_position.version
    ), 'idempotencyKey', request_id)
  );
  return jsonb_build_object('id', v_position.public_id, 'version', v_position.version);
end;
$$;

create or replace function public.assign_current_member_role(
  p_member_id bigint,
  p_role_code text,
  p_version bigint,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_actor_auth_user_id uuid;
  v_target public.organization_members%rowtype;
  v_role_id bigint;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_tenant_id, v_organization_id, v_actor_member_id, v_actor_auth_user_id
  from public.current_organization_command_context('role.manage');
  if request_id is null or p_member_id is null or p_version is null or p_version < 1
     or p_role_code not in ('admin', 'department_head', 'employee', 'finance', 'hr') then
    raise exception 'Role command is invalid' using errcode = '22023';
  end if;
  select * into v_target from public.organization_members member
  where member.tenant_id = v_tenant_id and member.organization_id = v_organization_id
    and member.id = p_member_id and member.status in ('active', 'invited')
  for update;
  if not found then raise exception 'Organization target not found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.member_roles assignment join public.roles role
      on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
    where assignment.tenant_id = v_tenant_id and assignment.member_id = v_target.id and role.code = 'owner'
  ) then raise exception 'Owner role cannot be changed here' using errcode = '42501'; end if;
  if v_target.role_version <> p_version then raise exception 'Role version is stale' using errcode = '40001'; end if;
  select role.id into v_role_id from public.roles role
  where role.tenant_id = v_tenant_id and role.organization_id is null and role.code = p_role_code
    and role.is_system and role.is_enabled limit 1;
  if v_role_id is null then raise exception 'Requested role is unavailable' using errcode = 'P0002'; end if;
  insert into public.organization_command_idempotency (tenant_id, operation, idempotency_key)
  values (v_tenant_id, 'assign_current_member_role', request_id);
  select coalesce(jsonb_agg(role.code order by role.code), '[]'::jsonb) into v_before
  from public.member_roles assignment join public.roles role
    on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
  where assignment.tenant_id = v_tenant_id and assignment.member_id = v_target.id;
  delete from public.member_roles assignment using public.roles role
  where assignment.tenant_id = v_tenant_id and assignment.member_id = v_target.id
    and role.tenant_id = assignment.tenant_id and role.id = assignment.role_id and role.code <> 'owner';
  insert into public.member_roles (tenant_id, member_id, role_id, assignment_source)
  values (v_tenant_id, v_target.id, v_role_id, 'manual')
  on conflict (tenant_id, member_id, role_id) do update set assignment_source = 'manual';
  update public.organization_members member set role_version = member.role_version + 1
  where member.id = v_target.id returning * into v_target;
  select coalesce(jsonb_agg(role.code order by role.code), '[]'::jsonb) into v_after
  from public.member_roles assignment join public.roles role
    on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
  where assignment.tenant_id = v_tenant_id and assignment.member_id = v_target.id;
  perform public.append_audit_log(
    v_tenant_id, v_organization_id, v_actor_auth_user_id, v_actor_member_id,
    'organization.role_assigned', 'organization_member', v_target.id::text, request_id, null,
    jsonb_build_object('before', jsonb_build_object('roleCodes', v_before, 'version', p_version),
      'after', jsonb_build_object('roleCodes', v_after, 'version', v_target.role_version),
      'idempotencyKey', request_id)
  );
  return jsonb_build_object('memberId', v_target.id, 'roleCode', p_role_code, 'version', v_target.role_version);
end;
$$;

revoke all on function public.current_organization_command_context(text) from public, anon, authenticated, service_role;
revoke all on function public.create_current_department(text,text,text,integer,uuid) from public, anon;
revoke all on function public.update_current_department(uuid,text,text,integer,bigint,uuid) from public, anon;
revoke all on function public.upsert_current_position(uuid,text,text,text,text,uuid,bigint,uuid) from public, anon;
revoke all on function public.assign_current_member_role(bigint,text,bigint,uuid) from public, anon;
grant execute on function public.create_current_department(text,text,text,integer,uuid) to authenticated;
grant execute on function public.update_current_department(uuid,text,text,integer,bigint,uuid) to authenticated;
grant execute on function public.upsert_current_position(uuid,text,text,text,text,uuid,bigint,uuid) to authenticated;
grant execute on function public.assign_current_member_role(bigint,text,bigint,uuid) to authenticated;
