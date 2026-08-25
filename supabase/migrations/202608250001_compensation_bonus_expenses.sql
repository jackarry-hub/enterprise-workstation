-- Commercial compensation foundation:
-- 1) employee grade fields for department-grade salary policies
-- 2) auditable project bonus pools and task bonus allocations
-- 3) first-class reimbursement ledger linked to approval workflow

alter table public.employee_profiles
  add column if not exists salary_grade_code text not null default 'P1',
  add column if not exists job_level smallint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_profiles_salary_grade_code_check'
      and conrelid = 'public.employee_profiles'::regclass
  ) then
    alter table public.employee_profiles
      add constraint employee_profiles_salary_grade_code_check
      check (
        salary_grade_code = upper(btrim(salary_grade_code))
        and length(btrim(salary_grade_code)) between 2 and 12
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_profiles_job_level_check'
      and conrelid = 'public.employee_profiles'::regclass
  ) then
    alter table public.employee_profiles
      add constraint employee_profiles_job_level_check
      check (job_level between 1 and 20);
  end if;
end $$;

create index if not exists employee_profiles_grade_lookup_idx
  on public.employee_profiles (organization_id, department_id, salary_grade_code, job_level)
  where deleted_at is null;

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
      select array_agg(distinct role.code)
      from public.member_roles assignment
      join public.roles role
        on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
      where assignment.tenant_id = member.tenant_id
        and assignment.member_id = member.id
        and role.is_enabled
    ), '{}'::text[]),
    'permissionCodes', coalesce((
      select array_agg(distinct permission.code)
      from public.member_roles assignment
      join public.role_permissions role_permission
        on role_permission.tenant_id = assignment.tenant_id
       and role_permission.role_id = assignment.role_id
      join public.permissions permission on permission.id = role_permission.permission_id
      where assignment.tenant_id = member.tenant_id
        and assignment.member_id = member.id
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

create table public.salary_grade_policies (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  department_id bigint,
  job_family text not null default 'general' check (length(btrim(job_family)) between 1 and 80),
  salary_grade_code text not null
    check (salary_grade_code = upper(btrim(salary_grade_code)) and length(btrim(salary_grade_code)) between 2 and 12),
  job_level smallint not null check (job_level between 1 and 20),
  base_salary numeric(14,2) not null check (base_salary >= 0),
  salary_band_min numeric(14,2) not null check (salary_band_min >= 0),
  salary_band_max numeric(14,2) not null check (salary_band_max >= 0),
  performance_weight numeric(5,4) not null default 0.2000 check (performance_weight >= 0 and performance_weight <= 1),
  status text not null default 'active' check (status in ('active', 'archived')),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id)
    references public.departments (tenant_id, id) on delete restrict,
  check (salary_band_min <= base_salary and base_salary <= salary_band_max),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index salary_grade_policies_active_uidx
  on public.salary_grade_policies (
    tenant_id,
    organization_id,
    coalesce(department_id, 0),
    job_family,
    salary_grade_code,
    job_level,
    effective_from
  )
  where deleted_at is null;

create index salary_grade_policies_lookup_idx
  on public.salary_grade_policies (
    tenant_id,
    organization_id,
    department_id,
    salary_grade_code,
    job_level,
    effective_from desc
  )
  where deleted_at is null and status = 'active';

create table public.project_bonus_pools (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  project_id bigint not null,
  payroll_month date not null,
  pool_name text not null check (length(btrim(pool_name)) between 1 and 120),
  amount numeric(14,2) not null check (amount >= 0),
  allocated_amount numeric(14,2) not null default 0 check (allocated_amount >= 0),
  funding_source text not null default 'project_margin' check (length(btrim(funding_source)) between 1 and 80),
  status text not null default 'draft' check (status in ('draft', 'approved', 'locked', 'paid')),
  approved_by_member_id bigint,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete restrict,
  foreign key (organization_id, approved_by_member_id)
    references public.organization_members (organization_id, id) on delete restrict,
  unique (tenant_id, organization_id, id),
  check (extract(day from payroll_month) = 1),
  check (allocated_amount <= amount),
  check (
    (status = 'draft' and approved_by_member_id is null and approved_at is null)
    or (status in ('approved', 'locked', 'paid') and approved_by_member_id is not null and approved_at is not null)
  )
);

create unique index project_bonus_pools_project_month_uidx
  on public.project_bonus_pools (organization_id, project_id, payroll_month)
  where deleted_at is null;

create index project_bonus_pools_project_idx
  on public.project_bonus_pools (organization_id, project_id, payroll_month desc, status)
  where deleted_at is null;

create table public.task_bonus_allocations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  bonus_pool_id bigint not null,
  task_id bigint not null,
  employee_profile_id bigint not null,
  payroll_month date not null,
  amount numeric(14,2) not null check (amount >= 0),
  difficulty_score smallint not null check (difficulty_score between 1 and 5),
  quality_score smallint not null check (quality_score between 0 and 100),
  efficiency_score smallint not null check (efficiency_score between 0 and 100),
  priority_weight numeric(5,4) not null default 1 check (priority_weight > 0 and priority_weight <= 5),
  role_weight numeric(5,4) not null default 1 check (role_weight > 0 and role_weight <= 5),
  manual_adjustment_amount numeric(14,2) not null default 0,
  manual_adjustment_reason text not null default '',
  calculated_detail jsonb not null default '{}'::jsonb check (jsonb_typeof(calculated_detail) = 'object'),
  created_by_member_id bigint not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id, bonus_pool_id)
    references public.project_bonus_pools (tenant_id, organization_id, id) on delete restrict,
  foreign key (organization_id, task_id)
    references public.tasks (organization_id, id) on delete restrict,
  foreign key (organization_id, employee_profile_id)
    references public.employee_profiles (organization_id, id) on delete restrict,
  foreign key (organization_id, created_by_member_id)
    references public.organization_members (organization_id, id) on delete restrict,
  check (extract(day from payroll_month) = 1),
  check (manual_adjustment_amount = 0 or length(btrim(manual_adjustment_reason)) > 0)
);

create unique index task_bonus_allocations_task_employee_uidx
  on public.task_bonus_allocations (organization_id, task_id, employee_profile_id, payroll_month);

create index task_bonus_allocations_employee_month_idx
  on public.task_bonus_allocations (organization_id, employee_profile_id, payroll_month desc);

create index task_bonus_allocations_pool_idx
  on public.task_bonus_allocations (bonus_pool_id, created_at desc);

create table public.expense_reports (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  approval_id bigint,
  requester_employee_id bigint not null,
  owner_employee_id bigint,
  project_id bigint,
  expense_code text not null check (length(btrim(expense_code)) between 1 and 80),
  expense_type text not null check (length(btrim(expense_type)) between 1 and 80),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'CNY' check (currency = upper(btrim(currency)) and length(currency) = 3),
  expense_date date not null,
  description text not null default '',
  receipt_file_ids text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (organization_id, approval_id)
    references public.approvals (organization_id, id) on delete set null,
  foreign key (organization_id, requester_employee_id)
    references public.employee_profiles (organization_id, id) on delete restrict,
  foreign key (organization_id, owner_employee_id)
    references public.employee_profiles (organization_id, id) on delete restrict,
  foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete set null,
  check (status = 'paid' or paid_at is null),
  check (cardinality(receipt_file_ids) <= 20)
);

create unique index expense_reports_code_uidx
  on public.expense_reports (organization_id, expense_code)
  where deleted_at is null;

create index expense_reports_requester_status_idx
  on public.expense_reports (organization_id, requester_employee_id, status, expense_date desc)
  where deleted_at is null;

create index expense_reports_owner_status_idx
  on public.expense_reports (organization_id, owner_employee_id, status, expense_date desc)
  where owner_employee_id is not null and deleted_at is null;

create index expense_reports_approval_idx
  on public.expense_reports (approval_id)
  where approval_id is not null and deleted_at is null;

alter table public.salary_grade_policies enable row level security;
alter table public.salary_grade_policies force row level security;
alter table public.project_bonus_pools enable row level security;
alter table public.project_bonus_pools force row level security;
alter table public.task_bonus_allocations enable row level security;
alter table public.task_bonus_allocations force row level security;
alter table public.expense_reports enable row level security;
alter table public.expense_reports force row level security;

create policy salary_grade_policies_member_select on public.salary_grade_policies
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.is_organization_member(organization_id))
  );

create policy salary_grade_policies_finance_insert on public.salary_grade_policies
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance']))
  );

create policy salary_grade_policies_finance_update on public.salary_grade_policies
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance']))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance']))
  );

create policy project_bonus_pools_member_select on public.project_bonus_pools
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.is_organization_member(organization_id))
  );

create policy project_bonus_pools_finance_insert on public.project_bonus_pools
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'department_head', 'finance']))
  );

create policy project_bonus_pools_finance_update on public.project_bonus_pools
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'finance']))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'finance']))
  );

create policy task_bonus_allocations_member_select on public.task_bonus_allocations
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance']))
      or exists (
        select 1
        from public.employee_profiles profile
        join public.organization_members member
          on member.tenant_id = profile.tenant_id
         and member.id = profile.organization_member_id
        where profile.tenant_id = task_bonus_allocations.tenant_id
          and profile.organization_id = task_bonus_allocations.organization_id
          and profile.id = task_bonus_allocations.employee_profile_id
          and profile.deleted_at is null
          and member.user_id = (select auth.uid())
          and member.status = 'active'
      )
    )
  );

create policy task_bonus_allocations_finance_insert on public.task_bonus_allocations
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'department_head', 'finance']))
  );

create policy expense_reports_member_select on public.expense_reports
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (
      (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance']))
      or exists (
        select 1
        from public.employee_profiles profile
        join public.organization_members member
          on member.tenant_id = profile.tenant_id
         and member.id = profile.organization_member_id
        where profile.tenant_id = expense_reports.tenant_id
          and profile.organization_id = expense_reports.organization_id
          and profile.id in (expense_reports.requester_employee_id, expense_reports.owner_employee_id)
          and profile.deleted_at is null
          and member.user_id = (select auth.uid())
          and member.status = 'active'
      )
    )
  );

create policy expense_reports_self_insert on public.expense_reports
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.employee_profiles profile
      join public.organization_members member
        on member.tenant_id = profile.tenant_id
       and member.id = profile.organization_member_id
      where profile.tenant_id = expense_reports.tenant_id
        and profile.organization_id = expense_reports.organization_id
        and profile.id = expense_reports.requester_employee_id
        and profile.deleted_at is null
        and member.user_id = (select auth.uid())
        and member.status = 'active'
    )
  );

create policy expense_reports_owner_update on public.expense_reports
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (
      (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance']))
      or exists (
        select 1
        from public.employee_profiles profile
        join public.organization_members member
          on member.tenant_id = profile.tenant_id
         and member.id = profile.organization_member_id
        where profile.tenant_id = expense_reports.tenant_id
          and profile.organization_id = expense_reports.organization_id
          and profile.id = expense_reports.requester_employee_id
          and expense_reports.status in ('draft', 'rejected')
          and profile.deleted_at is null
          and member.user_id = (select auth.uid())
          and member.status = 'active'
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance']))
      or status in ('draft', 'submitted')
    )
  );

grant select, insert, update on public.salary_grade_policies,
  public.project_bonus_pools,
  public.expense_reports
  to authenticated;
grant select, insert on public.task_bonus_allocations to authenticated;
grant usage, select on all sequences in schema public to authenticated;

comment on column public.employee_profiles.salary_grade_code is
  'Configurable compensation grade, for example P5, P6, M4.';
comment on column public.employee_profiles.job_level is
  'Numerical level used with department salary policies and role permissions.';
comment on table public.salary_grade_policies is
  'Department plus grade salary policy. Finance/HR maintain this instead of manually deciding pay ad hoc.';
comment on table public.project_bonus_pools is
  'Project-level bonus pool approved from project budget or profit and allocated by contribution.';
comment on table public.task_bonus_allocations is
  'Append-only allocation evidence linking task difficulty, quality and efficiency to employee project bonus.';
comment on table public.expense_reports is
  'Reimbursement ledger linked to approval workflow and receipts.';
