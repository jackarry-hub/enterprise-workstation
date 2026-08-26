-- Keep compensation classification out of the authenticated directory projection.
-- The only authenticated paths to these fields are the two no-target RPCs below.

create or replace function public.current_employee_salary_classification()
returns table (
  organization_member_id bigint,
  salary_grade_code text,
  job_level smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.organization_member_id,
    profile.salary_grade_code,
    profile.job_level
  from public.organization_members member
  join public.employee_profiles profile
    on profile.tenant_id = member.tenant_id
   and profile.organization_id = member.organization_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
   and profile.employment_status in ('probation', 'active', 'on_leave')
  where member.tenant_id = (select public.current_tenant_id())
    and member.user_id = (select auth.uid())
    and member.status = 'active'
    and (
      (select public.has_organization_permission(member.organization_id, 'salary.self'))
      or (select public.has_organization_permission(member.organization_id, 'salary.manage'))
    )
  order by profile.id
  limit 1;
$$;

create or replace function public.managed_employee_salary_classifications()
returns table (
  organization_member_id bigint,
  salary_grade_code text,
  job_level smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.organization_member_id,
    profile.salary_grade_code,
    profile.job_level
  from public.employee_profiles profile
  where profile.tenant_id = (select public.current_tenant_id())
    and profile.deleted_at is null
    and profile.employment_status in ('probation', 'active', 'on_leave')
    and (select public.has_organization_permission(profile.organization_id, 'salary.manage'))
  order by profile.organization_member_id;
$$;

revoke all on function public.current_employee_salary_classification() from public, anon, authenticated;
revoke all on function public.managed_employee_salary_classifications() from public, anon, authenticated;
grant execute on function public.current_employee_salary_classification() to authenticated;
grant execute on function public.managed_employee_salary_classifications() to authenticated;

revoke select on table public.employee_profiles from public, anon, authenticated;
grant select (
  id,
  public_id,
  tenant_id,
  organization_id,
  organization_member_id,
  employee_no,
  display_name,
  avatar_url,
  work_email,
  phone,
  department_id,
  position_template_id,
  job_title,
  manager_employee_id,
  employment_type,
  employment_status,
  hire_date,
  departure_date,
  skills,
  created_at,
  updated_at,
  deleted_at
) on table public.employee_profiles to authenticated;
