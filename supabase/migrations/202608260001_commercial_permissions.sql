create or replace function public.ensure_commercial_permission_catalog()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.permissions (code, name, module, action)
  values
    ('ai.config.manage', '管理 AI 配置', 'ai', 'config.manage'),
    ('role.manage', '管理角色与权限', 'roles', 'manage'),
    ('customer.manage', '管理客户', 'customers', 'manage'),
    ('approval.submit', '提交审批', 'approvals', 'submit'),
    ('approval.act', '处理审批', 'approvals', 'act'),
    ('expense.manage', '管理费用报销', 'expenses', 'manage'),
    ('knowledge.manage', '管理知识库', 'knowledge', 'manage'),
    ('agent.manage', '管理智能体', 'agents', 'manage'),
    ('agent.orchestrate', '编排智能体', 'agents', 'orchestrate'),
    ('analytics.read', '查看经营分析', 'analytics', 'read'),
    ('settings.manage', '管理系统设置', 'settings', 'manage')
  on conflict (code) do update
  set name = excluded.name,
      module = excluded.module,
      action = excluded.action;
end;
$$;

create or replace function public.is_commercial_baseline_system_role(
  p_is_system boolean,
  p_is_enabled boolean,
  p_organization_id bigint,
  p_code text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_is_system, false)
    and coalesce(p_is_enabled, false)
    and p_organization_id is null
    and p_code = any (array['owner', 'admin']::text[]);
$$;

create or replace function public.grant_commercial_permission_baseline_to_role(
  p_tenant_id bigint,
  p_role_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_role_id is null then
    raise exception 'Commercial permission baseline requires a role and tenant'
      using errcode = '22023';
  end if;

  perform public.ensure_commercial_permission_catalog();

  insert into public.role_permissions (tenant_id, role_id, permission_id)
  select role.tenant_id, role.id, permission.id
  from public.roles role
  join public.permissions permission on permission.code = any (array[
    'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
    'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
    'agent.orchestrate', 'analytics.read', 'settings.manage'
  ]::text[])
  where role.tenant_id = p_tenant_id
    and role.id = p_role_id
    and public.is_commercial_baseline_system_role(
      role.is_system, role.is_enabled, role.organization_id, role.code
    )
  on conflict do nothing;
end;
$$;

create or replace function public.revoke_commercial_permissions_before_system_role_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Run before the row changes so a tenant_id update is not blocked by the
  -- composite role_permissions foreign key. Ordinary/custom roles keep their
  -- explicit catalog grants; only an OLD qualifying baseline role is revoked.
  if public.is_commercial_baseline_system_role(
    old.is_system, old.is_enabled, old.organization_id, old.code
  ) then
    delete from public.role_permissions assignment
    using public.permissions permission
    where assignment.tenant_id = old.tenant_id
      and assignment.role_id = old.id
      and assignment.permission_id = permission.id
      and permission.code = any (array[
        'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
        'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
        'agent.orchestrate', 'analytics.read', 'settings.manage'
      ]::text[]);
  end if;

  return new;
end;
$$;

create or replace function public.apply_commercial_permissions_after_system_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_commercial_baseline_system_role(
    new.is_system, new.is_enabled, new.organization_id, new.code
  ) then
    perform public.grant_commercial_permission_baseline_to_role(
      new.tenant_id, new.id
    );
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_commercial_permission_catalog()
  from public, anon, authenticated;
revoke all on function public.is_commercial_baseline_system_role(
  boolean, boolean, bigint, text
) from public, anon, authenticated;
revoke all on function public.grant_commercial_permission_baseline_to_role(
  bigint, bigint
)
  from public, anon, authenticated;
revoke all on function public.revoke_commercial_permissions_before_system_role_update()
  from public, anon, authenticated;
revoke all on function public.apply_commercial_permissions_after_system_role_change()
  from public, anon, authenticated;

drop trigger if exists roles_commercial_permission_baseline on public.roles;
drop trigger if exists roles_commercial_permission_baseline_insert on public.roles;
drop trigger if exists roles_commercial_permission_baseline_update on public.roles;
drop trigger if exists roles_commercial_permission_baseline_before_update on public.roles;
create trigger roles_commercial_permission_baseline_insert
after insert on public.roles
for each row execute function public.apply_commercial_permissions_after_system_role_change();
create trigger roles_commercial_permission_baseline_before_update
before update of is_enabled, is_system, organization_id, code, tenant_id on public.roles
for each row execute function public.revoke_commercial_permissions_before_system_role_update();
create trigger roles_commercial_permission_baseline_update
after update of is_enabled, is_system, organization_id, code, tenant_id on public.roles
for each row execute function public.apply_commercial_permissions_after_system_role_change();

select public.ensure_commercial_permission_catalog();
select public.grant_commercial_permission_baseline_to_role(role.tenant_id, role.id)
from public.roles role
where public.is_commercial_baseline_system_role(
  role.is_system, role.is_enabled, role.organization_id, role.code
);

create or replace function public.is_canonical_workspace_role_code(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code = any (array[
    'owner', 'admin', 'department_head', 'employee', 'finance', 'hr'
  ]::text[]);
$$;

update public.roles role
set is_enabled = false
where role.is_enabled
  and public.is_canonical_workspace_role_code(role.code)
  and (not role.is_system or role.organization_id is not null);

create or replace function public.enforce_canonical_workspace_role_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_canonical_workspace_role_code(new.code)
     and (not new.is_system or new.organization_id is not null) then
    raise exception 'Canonical workspace role codes require a global system role'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.is_canonical_workspace_role_code(text)
  from public, anon, authenticated;
revoke all on function public.enforce_canonical_workspace_role_shape()
  from public, anon, authenticated;

drop trigger if exists roles_canonical_workspace_role_shape on public.roles;
create trigger roles_canonical_workspace_role_shape
before insert or update of code, is_system, organization_id on public.roles
for each row execute function public.enforce_canonical_workspace_role_shape();

create or replace function public.enforce_member_role_organization_compatibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_organization_id bigint;
  v_role_organization_id bigint;
begin
  select member.organization_id
  into v_member_organization_id
  from public.organization_members member
  where member.tenant_id = new.tenant_id
    and member.id = new.member_id
  for share;
  if not found then
    return new;
  end if;

  select role.organization_id
  into v_role_organization_id
  from public.roles role
  where role.tenant_id = new.tenant_id
    and role.id = new.role_id
  for share;
  if not found then
    return new;
  end if;

  if v_role_organization_id is not null
     and v_role_organization_id is distinct from v_member_organization_id then
    raise exception 'Member role organization must be global or match the member organization'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_member_role_organization_compatibility()
  from public, anon, authenticated;

drop trigger if exists member_roles_organization_compatibility on public.member_roles;
create trigger member_roles_organization_compatibility
before insert or update of tenant_id, member_id, role_id on public.member_roles
for each row execute function public.enforce_member_role_organization_compatibility();

create or replace function public.current_workspace_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tenantId', tenant.public_id,
    'authUserId', member.user_id,
    'organizationId', organization.public_id,
    'organizationName', organization.name,
    'memberId', member.id,
    'employeeProfileId', profile.public_id,
    'memberStatus', member.status,
    'displayName', profile.display_name,
    'avatarUrl', profile.avatar_url,
    'departmentName', coalesce(department.name, '未分配部门'),
    'jobTitle', profile.job_title,
    'salaryGradeCode', profile.salary_grade_code,
    'jobLevel', profile.job_level,
    'employmentStatus', profile.employment_status,
    'skills', profile.skills,
    'providerCode', provider.provider_code,
    'authProvider', provider.auth_provider,
    'providerSubject', external.provider_subject,
    'roleCodes', coalesce((
      select array_agg(distinct r.code)
      from public.member_roles assignment
      join public.roles r
        on r.tenant_id = assignment.tenant_id and r.id = assignment.role_id
      where assignment.tenant_id = member.tenant_id
        and assignment.member_id = member.id
        and r.is_enabled
        and r.is_system
        and r.organization_id is null
        and public.is_canonical_workspace_role_code(r.code)
    ), '{}'::text[]),
    'customRoleCodes', coalesce((
      select array_agg(distinct r.code)
      from public.member_roles assignment
      join public.roles r
        on r.tenant_id = assignment.tenant_id and r.id = assignment.role_id
      where assignment.tenant_id = member.tenant_id
        and assignment.member_id = member.id
        and r.is_enabled
        and (r.organization_id is null or r.organization_id = member.organization_id)
        and not public.is_canonical_workspace_role_code(r.code)
    ), '{}'::text[]),
    'permissionCodes', coalesce((
      select array_agg(distinct permission.code)
      from public.member_roles assignment
      join public.roles r
        on r.tenant_id = assignment.tenant_id and r.id = assignment.role_id
      join public.role_permissions role_permission
        on role_permission.tenant_id = assignment.tenant_id
       and role_permission.role_id = assignment.role_id
      join public.permissions permission on permission.id = role_permission.permission_id
      where assignment.tenant_id = member.tenant_id
        and assignment.member_id = member.id
        and r.is_enabled
        and (r.organization_id is null or r.organization_id = member.organization_id)
    ), '{}'::text[])
  )
  from public.external_identities external
  join public.identity_providers provider
    on provider.tenant_id = external.tenant_id
   and provider.id = external.identity_provider_id
   and provider.status = 'active'
  join public.tenants tenant
    on tenant.id = external.tenant_id and tenant.status = 'active'
  join public.organizations organization
    on organization.tenant_id = external.tenant_id
   and organization.id = external.organization_id
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.id = external.organization_member_id
   and member.organization_id = external.organization_id
  join public.employee_profiles profile
    on profile.tenant_id = external.tenant_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
  left join public.departments department
    on department.tenant_id = profile.tenant_id
   and department.id = profile.department_id
   and department.deleted_at is null
  where external.auth_user_id = (select auth.uid())
    and external.status = 'active'
    and member.status = 'active'
    and profile.employment_status in ('probation', 'active', 'on_leave')
  limit 1;
$$;

revoke execute on function public.current_workspace_access() from public, anon;
grant execute on function public.current_workspace_access() to authenticated;
