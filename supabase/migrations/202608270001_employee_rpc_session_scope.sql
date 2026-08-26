-- The earlier employee RPC migration established organization arguments, but
-- an active organization_members row alone is not a session selector: one auth
-- identity can have multiple memberships. Bind the argument to its single
-- active external identity before exposing directory or private data.
do $$
begin
  if to_regprocedure('public.current_employee_directory()') is not null then
    execute 'revoke all on function public.current_employee_directory() from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.current_employee_directory(uuid)') is not null then
    execute 'revoke all on function public.current_employee_directory(uuid) from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.current_employee_private_profile(uuid)') is not null then
    execute 'revoke all on function public.current_employee_private_profile(uuid) from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.current_employee_private_profile(uuid, uuid)') is not null then
    execute 'revoke all on function public.current_employee_private_profile(uuid, uuid) from public, anon, authenticated, service_role';
  end if;
end;
$$;

drop function if exists public.current_employee_directory();
drop function if exists public.current_employee_directory(uuid);
drop function if exists public.current_employee_private_profile(uuid);
drop function if exists public.current_employee_private_profile(uuid, uuid);

create or replace function public.current_employee_directory(
  p_organization_public_id uuid
)
returns table (
  employee_public_id uuid,
  employee_no text,
  display_name text,
  avatar_url text,
  department_public_id uuid,
  department_code text,
  department_name text,
  department_status text,
  department_sort_order integer,
  job_title text,
  manager_employee_public_id uuid,
  manager_display_name text,
  employment_type text,
  employment_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.public_id,
    profile.employee_no,
    profile.display_name,
    profile.avatar_url,
    department.public_id,
    department.code,
    department.name,
    department.status,
    department.sort_order,
    profile.job_title,
    manager.public_id,
    manager.display_name,
    profile.employment_type,
    profile.employment_status
  from public.external_identities identity
  join public.organization_members member
    on member.tenant_id = identity.tenant_id
   and member.organization_id = identity.organization_id
   and member.id = identity.organization_member_id
   and member.user_id = (select auth.uid())
   and member.status = 'active'
  join public.organizations organization
    on organization.id = identity.organization_id
   and organization.tenant_id = identity.tenant_id
   and organization.public_id = p_organization_public_id
  join public.employee_profiles profile
    on profile.tenant_id = identity.tenant_id
   and profile.organization_id = identity.organization_id
   and profile.deleted_at is null
   and profile.employment_status in ('probation', 'active', 'on_leave')
  left join public.organization_members target_member
    on target_member.tenant_id = profile.tenant_id
   and target_member.organization_id = profile.organization_id
   and target_member.id = profile.organization_member_id
  left join public.departments department
    on department.tenant_id = profile.tenant_id
   and department.organization_id = profile.organization_id
   and department.id = profile.department_id
   and department.deleted_at is null
  left join public.employee_profiles manager
    on manager.tenant_id = profile.tenant_id
   and manager.organization_id = profile.organization_id
   and manager.id = profile.manager_employee_id
   and manager.deleted_at is null
   and manager.employment_status in ('probation', 'active', 'on_leave')
   and (
     manager.organization_member_id is null
     or exists (
       select 1
       from public.organization_members manager_member
       where manager_member.tenant_id = manager.tenant_id
         and manager_member.organization_id = manager.organization_id
         and manager_member.id = manager.organization_member_id
         and manager_member.status in ('active', 'invited')
     )
   )
  where identity.tenant_id = (select public.current_tenant_id())
    and identity.auth_user_id = (select auth.uid())
    and identity.status = 'active'
    and (
      profile.organization_member_id is null
      or target_member.status in ('active', 'invited')
    )
  order by profile.employee_no;
$$;

create or replace function public.current_employee_private_profile(
  p_employee_public_id uuid,
  p_organization_public_id uuid
)
returns table (
  employee_public_id uuid,
  private_email text,
  phone text,
  hire_date date,
  departure_date date,
  sensitive_hr_notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.public_id,
    private.private_email,
    private.phone,
    private.hire_date,
    private.departure_date,
    private.sensitive_hr_notes
  from public.external_identities identity
  join public.organization_members viewer
    on viewer.tenant_id = identity.tenant_id
   and viewer.organization_id = identity.organization_id
   and viewer.id = identity.organization_member_id
   and viewer.user_id = (select auth.uid())
   and viewer.status = 'active'
  join public.organizations organization
    on organization.id = identity.organization_id
   and organization.tenant_id = identity.tenant_id
   and organization.public_id = p_organization_public_id
  join public.employee_profiles profile
    on profile.tenant_id = identity.tenant_id
   and profile.organization_id = identity.organization_id
   and profile.public_id = p_employee_public_id
   and profile.deleted_at is null
  join public.employee_private_profiles private
    on private.tenant_id = profile.tenant_id
   and private.organization_id = profile.organization_id
   and private.employee_profile_id = profile.id
  left join public.organization_members target_member
    on target_member.tenant_id = profile.tenant_id
   and target_member.organization_id = profile.organization_id
   and target_member.id = profile.organization_member_id
  where identity.tenant_id = (select public.current_tenant_id())
    and identity.auth_user_id = (select auth.uid())
    and identity.status = 'active'
    and (
      (
        target_member.id = viewer.organization_member_id
        and target_member.status = 'active'
        and profile.employment_status in ('probation', 'active', 'on_leave')
      )
      or (select public.has_organization_permission(profile.organization_id, 'hr.manage'))
      or (select public.has_organization_role(profile.organization_id, array['owner', 'admin']))
    );
$$;

revoke all on function public.current_employee_directory(uuid) from public, anon, authenticated, service_role;
revoke all on function public.current_employee_private_profile(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.current_employee_directory(uuid) to authenticated;
grant execute on function public.current_employee_private_profile(uuid, uuid) to authenticated;
