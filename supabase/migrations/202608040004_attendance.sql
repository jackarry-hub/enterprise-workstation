create table public.attendance (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  employee_profile_id bigint not null references public.employee_profiles(id) on delete restrict,
  attendance_date date not null,
  scheduled_start time not null default '09:00',
  scheduled_end time not null default '18:00',
  check_in_at timestamptz,
  check_out_at timestamptz,
  status text not null default 'normal'
    check (status in ('normal', 'late', 'early_leave', 'leave')),
  late_minutes integer not null default 0 check (late_minutes >= 0),
  early_leave_minutes integer not null default 0 check (early_leave_minutes >= 0),
  source text not null default 'manual'
    check (source in ('manual', 'import', 'device')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (check_out_at is null or check_in_at is null or check_out_at >= check_in_at)
);

create unique index attendance_organization_employee_date_idx
  on public.attendance (organization_id, employee_profile_id, attendance_date)
  where deleted_at is null;

create index attendance_organization_date_status_idx
  on public.attendance (organization_id, attendance_date desc, status)
  where deleted_at is null;

create index attendance_employee_date_idx
  on public.attendance (employee_profile_id, attendance_date desc)
  where deleted_at is null;

create or replace function public.touch_attendance_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger attendance_updated_at
before update on public.attendance
for each row execute function public.touch_attendance_updated_at();

create or replace function public.guard_attendance_employee_organization()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.employee_profiles employee
    where employee.id = new.employee_profile_id
      and employee.organization_id = new.organization_id
      and employee.deleted_at is null
  ) then
    raise exception 'Attendance employee must belong to the same organization'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger attendance_guard_employee_organization
before insert or update of organization_id, employee_profile_id
on public.attendance
for each row execute function public.guard_attendance_employee_organization();

alter table public.attendance enable row level security;
alter table public.attendance force row level security;

create policy attendance_member_select on public.attendance
  for select to authenticated
  using (
    deleted_at is null
    and (select public.is_organization_member(organization_id))
  );

create policy attendance_manager_insert on public.attendance
  for insert to authenticated
  with check (
    (select public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'hr']
    ))
  );

create policy attendance_manager_update on public.attendance
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

grant select, insert, update on public.attendance to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke execute on function public.touch_attendance_updated_at() from public;
revoke execute on function public.guard_attendance_employee_organization() from public;
