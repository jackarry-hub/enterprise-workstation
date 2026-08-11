create table public.salary (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  employee_profile_id bigint not null,
  payroll_month date not null,
  base_salary numeric(14,2) not null check (base_salary >= 0),
  bonus numeric(14,2) not null default 0 check (bonus >= 0),
  deductions numeric(14,2) not null default 0 check (deductions >= 0),
  net_salary numeric(14,2) not null check (net_salary >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'processing', 'paid')),
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (organization_id, employee_profile_id)
    references public.employee_profiles (organization_id, id) on delete restrict,
  check (extract(day from payroll_month) = 1),
  check (status = 'paid' or paid_at is null)
);

create unique index salary_organization_employee_month_idx
  on public.salary (organization_id, employee_profile_id, payroll_month)
  where deleted_at is null;

create index salary_organization_month_status_idx
  on public.salary (organization_id, payroll_month desc, status)
  where deleted_at is null;

create index salary_employee_month_idx
  on public.salary (employee_profile_id, payroll_month desc)
  where deleted_at is null;

create or replace function public.touch_salary_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger salary_updated_at
before update on public.salary
for each row execute function public.touch_salary_updated_at();

alter table public.salary enable row level security;
alter table public.salary force row level security;

create policy salary_self_or_manager_select on public.salary
  for select to authenticated
  using (
    deleted_at is null
    and (
      (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance']))
      or exists (
        select 1
        from public.employee_profiles employee
        join public.organization_members member on member.id = employee.organization_member_id
        where employee.id = salary.employee_profile_id
          and employee.organization_id = salary.organization_id
          and member.user_id = (select auth.uid())
          and employee.deleted_at is null
      )
    )
  );

create policy salary_manager_insert on public.salary
  for insert to authenticated
  with check ((select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance'])));

create policy salary_manager_update on public.salary
  for update to authenticated
  using (
    deleted_at is null
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance']))
  )
  with check ((select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance'])));

grant select, insert, update on public.salary to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke execute on function public.touch_salary_updated_at() from public;
