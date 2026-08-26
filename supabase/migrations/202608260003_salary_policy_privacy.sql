drop policy if exists salary_grade_policies_member_select
  on public.salary_grade_policies;
drop policy if exists salary_grade_policies_salary_manager_select
  on public.salary_grade_policies;

create policy salary_grade_policies_salary_manager_select
on public.salary_grade_policies for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and deleted_at is null
  and (select public.has_organization_permission(organization_id, 'salary.manage'))
);

create index if not exists salary_grade_policies_secure_lookup_idx
on public.salary_grade_policies (
  tenant_id,
  organization_id,
  job_family,
  salary_grade_code,
  job_level,
  department_id,
  effective_from desc
)
where deleted_at is null and status = 'active';

create or replace function public.current_salary_grade_policy()
returns table (
  public_id uuid,
  department_id bigint,
  job_family text,
  salary_grade_code text,
  job_level smallint,
  base_salary numeric,
  salary_band_min numeric,
  salary_band_max numeric,
  performance_weight numeric,
  effective_from date,
  effective_to date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    policy.public_id,
    policy.department_id,
    policy.job_family,
    policy.salary_grade_code,
    policy.job_level,
    policy.base_salary,
    policy.salary_band_min,
    policy.salary_band_max,
    policy.performance_weight,
    policy.effective_from,
    policy.effective_to
  from public.organization_members member
  join public.employee_profiles profile
    on profile.tenant_id = member.tenant_id
   and profile.organization_id = member.organization_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
   and profile.employment_status in ('probation', 'active', 'on_leave')
  join public.position_templates position
    on position.tenant_id = profile.tenant_id
   and position.organization_id = profile.organization_id
   and position.id = profile.position_template_id
   and position.status = 'active'
   and position.deleted_at is null
  join public.salary_grade_policies policy
    on policy.tenant_id = profile.tenant_id
   and policy.organization_id = profile.organization_id
   and (policy.department_id = profile.department_id or policy.department_id is null)
   and policy.job_family = position.category
   and policy.salary_grade_code = profile.salary_grade_code
   and policy.job_level = profile.job_level
   and policy.status = 'active'
   and policy.deleted_at is null
   and policy.effective_from <= current_date
   and (policy.effective_to is null or policy.effective_to >= current_date)
  where member.user_id = (select auth.uid())
    and member.status = 'active'
    and (
      (select public.has_organization_permission(member.organization_id, 'salary.self'))
      or (select public.has_organization_permission(member.organization_id, 'salary.manage'))
    )
  order by
    (policy.department_id = profile.department_id) desc,
    policy.effective_from desc,
    policy.id
  limit 1;
$$;

revoke all on function public.current_salary_grade_policy() from public, anon, authenticated;
grant execute on function public.current_salary_grade_policy() to authenticated;
