create table public.departments (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  parent_department_id bigint references public.departments(id) on delete restrict,
  code text not null check (length(btrim(code)) > 0),
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (parent_department_id is null or parent_department_id <> id)
);

create unique index departments_organization_code_idx
  on public.departments (organization_id, code)
  where deleted_at is null;

create index departments_organization_status_idx
  on public.departments (organization_id, status, sort_order)
  where deleted_at is null;

create index departments_parent_department_id_idx
  on public.departments (parent_department_id)
  where parent_department_id is not null and deleted_at is null;

create table public.employee_profiles (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  organization_member_id bigint references public.organization_members(id) on delete set null,
  employee_no text not null check (length(btrim(employee_no)) > 0),
  display_name text not null check (length(btrim(display_name)) > 0),
  avatar_url text,
  work_email text,
  phone text,
  department_id bigint references public.departments(id) on delete set null,
  job_title text not null default '员工' check (length(btrim(job_title)) > 0),
  manager_employee_id bigint references public.employee_profiles(id) on delete set null,
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time', 'part_time', 'contractor', 'intern')),
  employment_status text not null default 'active'
    check (employment_status in ('probation', 'active', 'on_leave', 'departed')),
  hire_date date,
  departure_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (manager_employee_id is null or manager_employee_id <> id),
  check (departure_date is null or hire_date is null or departure_date >= hire_date)
);

create unique index employee_profiles_organization_employee_no_idx
  on public.employee_profiles (organization_id, employee_no)
  where deleted_at is null;

create unique index employee_profiles_organization_member_id_idx
  on public.employee_profiles (organization_member_id)
  where organization_member_id is not null and deleted_at is null;

create index employee_profiles_organization_status_idx
  on public.employee_profiles (organization_id, employment_status, hire_date desc)
  where deleted_at is null;

create index employee_profiles_department_id_idx
  on public.employee_profiles (department_id)
  where department_id is not null and deleted_at is null;

create index employee_profiles_manager_employee_id_idx
  on public.employee_profiles (manager_employee_id)
  where manager_employee_id is not null and deleted_at is null;

create or replace function public.touch_employee_directory_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger departments_updated_at
before update on public.departments
for each row execute function public.touch_employee_directory_updated_at();

create trigger employee_profiles_updated_at
before update on public.employee_profiles
for each row execute function public.touch_employee_directory_updated_at();

create or replace function public.guard_department_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_department_id is null then
    return new;
  end if;

  if new.parent_department_id = new.id then
    raise exception 'A department cannot be its own parent' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.departments parent
    where parent.id = new.parent_department_id
      and parent.organization_id = new.organization_id
      and parent.deleted_at is null
  ) then
    raise exception 'Parent department must belong to the same organization' using errcode = '23514';
  end if;

  if exists (
    with recursive ancestors as (
      select department.id, department.parent_department_id
      from public.departments department
      where department.id = new.parent_department_id

      union all

      select parent.id, parent.parent_department_id
      from public.departments parent
      join ancestors on ancestors.parent_department_id = parent.id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'Department hierarchy cannot contain a cycle' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger departments_guard_hierarchy
before insert or update of organization_id, parent_department_id
on public.departments
for each row execute function public.guard_department_hierarchy();

create or replace function public.guard_employee_profile_relations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_member_id is not null and not exists (
    select 1
    from public.organization_members member
    where member.id = new.organization_member_id
      and member.organization_id = new.organization_id
  ) then
    raise exception 'Organization member must belong to the employee organization' using errcode = '23514';
  end if;

  if new.department_id is not null and not exists (
    select 1
    from public.departments department
    where department.id = new.department_id
      and department.organization_id = new.organization_id
      and department.deleted_at is null
  ) then
    raise exception 'Department must belong to the employee organization' using errcode = '23514';
  end if;

  if new.manager_employee_id is not null then
    if new.manager_employee_id = new.id then
      raise exception 'An employee cannot manage themselves' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.employee_profiles manager
      where manager.id = new.manager_employee_id
        and manager.organization_id = new.organization_id
        and manager.deleted_at is null
    ) then
      raise exception 'Manager must belong to the employee organization' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger employee_profiles_guard_relations
before insert or update of
  organization_id,
  organization_member_id,
  department_id,
  manager_employee_id
on public.employee_profiles
for each row execute function public.guard_employee_profile_relations();

alter table public.departments enable row level security;
alter table public.departments force row level security;
alter table public.employee_profiles enable row level security;
alter table public.employee_profiles force row level security;

create policy departments_member_select on public.departments
  for select to authenticated
  using (
    deleted_at is null
    and (select public.is_organization_member(organization_id))
  );

create policy departments_hr_insert on public.departments
  for insert to authenticated
  with check (
    (select public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'hr']
    ))
  );

create policy departments_hr_update on public.departments
  for update to authenticated
  using (
    deleted_at is null
    and (select public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'hr']
    ))
  )
  with check (
    (select public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'hr']
    ))
  );

create policy employee_profiles_member_select on public.employee_profiles
  for select to authenticated
  using (
    deleted_at is null
    and (select public.is_organization_member(organization_id))
  );

create policy employee_profiles_hr_insert on public.employee_profiles
  for insert to authenticated
  with check (
    (select public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'hr']
    ))
  );

create policy employee_profiles_hr_update on public.employee_profiles
  for update to authenticated
  using (
    deleted_at is null
    and (select public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'hr']
    ))
  )
  with check (
    (select public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'hr']
    ))
  );

grant select, insert, update on public.departments, public.employee_profiles
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke execute on function public.touch_employee_directory_updated_at() from public;
revoke execute on function public.guard_department_hierarchy() from public;
revoke execute on function public.guard_employee_profile_relations() from public;
