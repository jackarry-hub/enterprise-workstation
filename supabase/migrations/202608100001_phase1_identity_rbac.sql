alter table public.organization_members alter column user_id drop not null;

alter table public.departments
  add column description text,
  add column leader_member_id bigint references public.organization_members(id) on delete set null;

create or replace function public.guard_department_leader()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.leader_member_id is not null and not exists (
    select 1 from public.organization_members member
    where member.id = new.leader_member_id
      and member.organization_id = new.organization_id
      and member.status in ('invited', 'active')
  ) then
    raise exception 'Department leader must belong to the same organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger departments_guard_leader
before insert or update of organization_id, leader_member_id on public.departments
for each row execute function public.guard_department_leader();

create table public.external_identities (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  organization_member_id bigint not null references public.organization_members(id) on delete cascade,
  provider text not null default 'feishu' check (provider = 'feishu'),
  provider_user_id text,
  feishu_open_id text,
  feishu_union_id text,
  tenant_key text not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, organization_member_id),
  check (status = 'invited' or feishu_open_id is not null or feishu_union_id is not null or provider_user_id is not null)
);

create unique index external_identities_provider_user_idx
  on public.external_identities(provider, provider_user_id)
  where provider_user_id is not null;
create unique index external_identities_feishu_open_idx
  on public.external_identities(tenant_key, feishu_open_id)
  where feishu_open_id is not null;
create unique index external_identities_feishu_union_idx
  on public.external_identities(tenant_key, feishu_union_id)
  where feishu_union_id is not null;
create unique index external_identities_auth_user_idx
  on public.external_identities(auth_user_id)
  where auth_user_id is not null;
create unique index employee_profiles_organization_work_email_idx
  on public.employee_profiles(organization_id, lower(work_email))
  where work_email is not null and deleted_at is null;

insert into public.organizations (name, slug)
values ('量子星河', 'quantum-galaxy')
on conflict (slug) do update set name = excluded.name;

with company as (
  select id from public.organizations where slug = 'quantum-galaxy'
)
insert into public.departments (organization_id, code, name, description, sort_order)
select company.id, seed.code, seed.name, seed.description, seed.sort_order
from company
cross join (values
  ('AI', 'AI事业部', 'AI产品、研发与交付', 10),
  ('ECOM', '电商事业部', '电商业务增长与履约', 20),
  ('OPS', '运营部', '品牌、内容与业务运营', 30),
  ('FIN', '财务部', '预算、成本、收入与资金', 40),
  ('HR', '人力资源部', '组织、人才与员工服务', 50)
) as seed(code, name, description, sort_order)
on conflict (organization_id, code) where deleted_at is null
do update set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.organization_id is null and role.code in ('owner', 'admin')
on conflict do nothing;

with matrix(role_code, permission_code) as (values
  ('department_head', 'department.manage'), ('department_head', 'project.manage'),
  ('department_head', 'task.manage'), ('department_head', 'attendance.self'),
  ('department_head', 'attendance.manage'), ('department_head', 'approval.self'),
  ('department_head', 'approval.manage'), ('department_head', 'files.manage'),
  ('employee', 'task.manage'), ('employee', 'attendance.self'),
  ('employee', 'salary.self'), ('employee', 'approval.self'), ('employee', 'files.manage'),
  ('finance', 'salary.manage'), ('finance', 'attendance.self'),
  ('finance', 'approval.self'), ('finance', 'approval.manage'), ('finance', 'files.manage'),
  ('hr', 'hr.manage'), ('hr', 'attendance.self'), ('hr', 'attendance.manage'),
  ('hr', 'salary.self'), ('hr', 'salary.manage'), ('hr', 'approval.self'),
  ('hr', 'approval.manage'), ('hr', 'files.manage')
)
insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from matrix
join public.roles role on role.code = matrix.role_code and role.organization_id is null
join public.permissions permission on permission.code = matrix.permission_code
on conflict do nothing;

create or replace function public.provision_feishu_employee(
  p_employee_no text,
  p_display_name text,
  p_department_code text,
  p_job_title text,
  p_role_code text,
  p_tenant_key text,
  p_feishu_union_id text,
  p_feishu_open_id text default null,
  p_work_email text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id bigint;
  v_department_id bigint;
  v_role_id bigint;
  v_member_id bigint;
  v_profile_id bigint;
begin
  if p_role_code not in ('owner', 'department_head', 'employee', 'finance', 'hr') then
    raise exception 'Unsupported workspace role' using errcode = '22023';
  end if;
  if nullif(btrim(p_employee_no), '') is null
     or nullif(btrim(p_display_name), '') is null
     or nullif(btrim(p_tenant_key), '') is null
     or (nullif(btrim(p_feishu_union_id), '') is null
         and nullif(btrim(p_feishu_open_id), '') is null
         and nullif(btrim(p_work_email), '') is null) then
    raise exception 'Employee identity fields are incomplete' using errcode = '22023';
  end if;

  select id into strict v_organization_id from public.organizations where slug = 'quantum-galaxy';
  select id into strict v_department_id
    from public.departments
    where organization_id = v_organization_id and code = p_department_code and deleted_at is null;
  select id into strict v_role_id
    from public.roles
    where code = p_role_code and organization_id is null and is_enabled;

  select profile.id, profile.organization_member_id
    into v_profile_id, v_member_id
    from public.employee_profiles profile
    where profile.organization_id = v_organization_id
      and profile.employee_no = btrim(p_employee_no)
      and profile.deleted_at is null;

  if v_profile_id is null then
    insert into public.organization_members (organization_id, user_id, status)
      values (v_organization_id, null, 'invited') returning id into v_member_id;
    insert into public.employee_profiles (
      organization_id, organization_member_id, employee_no, display_name,
      work_email, department_id, job_title, employment_status
    ) values (
      v_organization_id, v_member_id, btrim(p_employee_no), btrim(p_display_name),
      nullif(btrim(p_work_email), ''), v_department_id, btrim(p_job_title), 'active'
    ) returning id into v_profile_id;
  else
    update public.employee_profiles set
      display_name = btrim(p_display_name), work_email = nullif(btrim(p_work_email), ''),
      department_id = v_department_id, job_title = btrim(p_job_title)
    where id = v_profile_id;
  end if;

  delete from public.member_roles assignment
  using public.roles role
  where assignment.member_id = v_member_id
    and assignment.role_id = role.id
    and role.code in ('owner', 'department_head', 'employee', 'finance', 'hr');
  insert into public.member_roles (member_id, role_id) values (v_member_id, v_role_id);

  insert into public.external_identities (
    organization_id, organization_member_id, tenant_key,
    feishu_union_id, feishu_open_id, status
  ) values (
    v_organization_id, v_member_id, btrim(p_tenant_key),
    nullif(btrim(p_feishu_union_id), ''), nullif(btrim(p_feishu_open_id), ''), 'invited'
  )
  on conflict (provider, organization_member_id) do update set
    tenant_key = excluded.tenant_key,
    feishu_union_id = excluded.feishu_union_id,
    feishu_open_id = excluded.feishu_open_id,
    status = case when public.external_identities.status = 'revoked' then 'revoked' else 'invited' end,
    updated_at = now();

  return v_member_id;
end;
$$;

create or replace function public.bind_preprovisioned_member(
  p_employee_no text,
  p_auth_user_id uuid,
  p_feishu_union_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id bigint;
  v_external_id bigint;
begin
  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'Auth user does not exist' using errcode = '23503';
  end if;

  select profile.organization_member_id, external.id
    into strict v_member_id, v_external_id
    from public.employee_profiles profile
    join public.organizations organization on organization.id = profile.organization_id and organization.slug = 'quantum-galaxy'
    join public.external_identities external on external.organization_member_id = profile.organization_member_id
    where profile.employee_no = btrim(p_employee_no)
      and profile.deleted_at is null
      and external.feishu_union_id = btrim(p_feishu_union_id)
      and external.status <> 'revoked';

  if exists (
    select 1 from public.organization_members member
    where member.user_id = p_auth_user_id and member.id <> v_member_id
  ) then raise exception 'Auth user is already bound' using errcode = '23505'; end if;

  update public.organization_members set user_id = p_auth_user_id, status = 'active' where id = v_member_id;
  update public.external_identities
    set auth_user_id = p_auth_user_id, status = 'active', updated_at = now()
    where id = v_external_id;
end;
$$;

create or replace function public.claim_current_feishu_identity()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_provider_user_id text;
  v_open_id text;
  v_union_id text;
  v_tenant_key text;
  v_email text;
  v_avatar_url text;
  v_external public.external_identities%rowtype;
  v_member_status text;
  v_employment_status text;
begin
  if v_auth_user_id is null then return 'unauthenticated'; end if;

  select identity.provider_id,
         coalesce(identity.identity_data ->> 'open_id', identity.provider_id),
         identity.identity_data ->> 'union_id',
         identity.identity_data ->> 'tenant_key',
         identity.identity_data ->> 'email',
         coalesce(identity.identity_data ->> 'picture', identity.identity_data ->> 'avatar_url')
    into v_provider_user_id, v_open_id, v_union_id, v_tenant_key, v_email, v_avatar_url
    from auth.identities identity
    where identity.user_id = v_auth_user_id and identity.provider = 'custom:feishu'
    order by identity.updated_at desc
    limit 1;
  if v_provider_user_id is null or v_tenant_key is null then return 'invalid_identity'; end if;

  select external.* into v_external
    from public.external_identities external
    join public.employee_profiles profile on profile.organization_member_id = external.organization_member_id and profile.deleted_at is null
    where external.provider = 'feishu'
      and external.tenant_key = v_tenant_key
      and (
        (v_union_id is not null and external.feishu_union_id = v_union_id)
        or (external.feishu_open_id = v_open_id)
        or (external.provider_user_id = v_provider_user_id)
        or (v_email is not null and lower(profile.work_email) = lower(v_email))
      )
    order by case
      when external.feishu_union_id = v_union_id then 0
      when external.feishu_open_id = v_open_id or external.provider_user_id = v_provider_user_id then 1
      else 2
    end
    limit 1
    for update;
  if v_external.id is null then return 'not_provisioned'; end if;
  if v_external.status = 'revoked' then return 'revoked'; end if;
  if v_external.auth_user_id is not null and v_external.auth_user_id <> v_auth_user_id then return 'identity_conflict'; end if;

  if exists (
    select 1 from public.organization_members member
    where member.user_id = v_auth_user_id and member.id <> v_external.organization_member_id
  ) then return 'identity_conflict'; end if;

  select member.status, profile.employment_status
    into v_member_status, v_employment_status
    from public.organization_members member
    join public.employee_profiles profile on profile.organization_member_id = member.id and profile.deleted_at is null
    where member.id = v_external.organization_member_id;
  if v_member_status is null or v_employment_status is null then return 'identity_conflict'; end if;
  if v_member_status = 'suspended' then return 'suspended'; end if;
  if v_employment_status = 'departed' then return 'departed'; end if;

  update public.organization_members
    set user_id = v_auth_user_id, status = 'active'
    where id = v_external.organization_member_id
      and (user_id is null or user_id = v_auth_user_id);
  if not found then return 'identity_conflict'; end if;

  update public.external_identities set
    provider_user_id = v_provider_user_id,
    feishu_open_id = coalesce(feishu_open_id, v_open_id),
    feishu_union_id = coalesce(feishu_union_id, v_union_id),
    auth_user_id = v_auth_user_id,
    status = 'active', last_login_at = now(), updated_at = now()
  where id = v_external.id;
  update public.employee_profiles
    set avatar_url = coalesce(nullif(v_avatar_url, ''), avatar_url)
    where organization_member_id = v_external.organization_member_id and deleted_at is null;
  return 'active';
end;
$$;

create or replace function public.current_workspace_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
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
    'employmentStatus', profile.employment_status,
    'roleCodes', coalesce(array_agg(distinct role.code) filter (where role.code is not null), array[]::text[]),
    'permissionCodes', coalesce((
      select array_agg(distinct permission.code)
      from public.member_roles member_role
      join public.role_permissions role_permission on role_permission.role_id = member_role.role_id
      join public.permissions permission on permission.id = role_permission.permission_id
      where member_role.member_id = member.id
    ), array[]::text[])
  )
  from public.organization_members member
  join public.organizations organization on organization.id = member.organization_id and organization.slug = 'quantum-galaxy'
  join public.employee_profiles profile on profile.organization_member_id = member.id and profile.deleted_at is null
  left join public.departments department on department.id = profile.department_id and department.deleted_at is null
  left join public.member_roles assignment on assignment.member_id = member.id
  left join public.roles role on role.id = assignment.role_id and role.is_enabled
  where member.user_id = (select auth.uid())
    and member.status = 'active'
    and profile.employment_status in ('probation', 'active', 'on_leave')
  group by member.id, organization.id, profile.id, department.id;
$$;

alter table public.external_identities enable row level security;
alter table public.external_identities force row level security;

create policy external_identities_self_select on public.external_identities
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

revoke all on public.external_identities from public, anon, authenticated;
grant select on public.external_identities to authenticated;

revoke execute on function public.provision_feishu_employee(text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.provision_feishu_employee(text,text,text,text,text,text,text,text,text) to service_role;
revoke execute on function public.bind_preprovisioned_member(text,uuid,text) from public, anon, authenticated;
grant execute on function public.bind_preprovisioned_member(text,uuid,text) to service_role;
revoke execute on function public.claim_current_feishu_identity() from public, anon;
grant execute on function public.claim_current_feishu_identity() to authenticated;
revoke execute on function public.current_workspace_access() from public, anon;
grant execute on function public.current_workspace_access() to authenticated;
