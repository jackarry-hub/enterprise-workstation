-- Keep employee PII in a private authority.  The legacy columns remain as a
-- transitional write/read compatibility surface for trusted server jobs only;
-- authenticated users lose column-level SELECT on them below.

-- The composite foreign key below must be backed by this precise tenant and
-- organization identity, even on installations that predate phase 3.
create unique index if not exists employee_profiles_tenant_organization_id_uidx
  on public.employee_profiles (tenant_id, organization_id, id);

create table public.employee_private_profiles (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  employee_profile_id bigint not null,
  private_email text,
  phone text,
  hire_date date,
  departure_date date,
  sensitive_hr_notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, organization_id, employee_profile_id),
  foreign key (tenant_id, organization_id, employee_profile_id)
    references public.employee_profiles (tenant_id, organization_id, id)
    on delete cascade,
  check (private_email is null or length(btrim(private_email)) between 3 and 320),
  check (phone is null or length(btrim(phone)) between 3 and 80),
  check (departure_date is null or hire_date is null or departure_date >= hire_date),
  check (sensitive_hr_notes is null or length(sensitive_hr_notes) <= 10000)
);

create index employee_private_profiles_lookup_idx
  on public.employee_private_profiles (tenant_id, organization_id, employee_profile_id);

alter table public.employee_private_profiles enable row level security;
alter table public.employee_private_profiles force row level security;

-- No caller receives direct table privileges.  Security-definer RPCs below are
-- the only authenticated read boundary, while trusted sync/payroll jobs retain
-- their legacy profile-column compatibility during the staged move.
revoke all on table public.employee_private_profiles from public, anon, authenticated, service_role;
revoke all on sequence public.employee_private_profiles_id_seq from public, anon, authenticated, service_role;

create or replace function public.touch_employee_private_profiles_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger employee_private_profiles_updated_at
before update on public.employee_private_profiles
for each row execute function public.touch_employee_private_profiles_updated_at();

insert into public.employee_private_profiles (
  tenant_id,
  organization_id,
  employee_profile_id,
  private_email,
  phone,
  hire_date,
  departure_date
)
select
  profile.tenant_id,
  profile.organization_id,
  profile.id,
  nullif(lower(btrim(profile.work_email)), ''),
  nullif(btrim(profile.phone), ''),
  profile.hire_date,
  profile.departure_date
from public.employee_profiles profile
on conflict (tenant_id, organization_id, employee_profile_id) do update
set
  private_email = excluded.private_email,
  phone = excluded.phone,
  hire_date = excluded.hire_date,
  departure_date = excluded.departure_date;

create or replace function public.sync_employee_profile_private_legacy_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.employee_private_profiles (
    tenant_id,
    organization_id,
    employee_profile_id,
    private_email,
    phone,
    hire_date,
    departure_date
  ) values (
    new.tenant_id,
    new.organization_id,
    new.id,
    nullif(lower(btrim(new.work_email)), ''),
    nullif(btrim(new.phone), ''),
    new.hire_date,
    new.departure_date
  )
  on conflict (tenant_id, organization_id, employee_profile_id) do update
  set
    private_email = case
      when new.work_email is distinct from old.work_email then excluded.private_email
      else employee_private_profiles.private_email
    end,
    phone = case
      when new.phone is distinct from old.phone then excluded.phone
      else employee_private_profiles.phone
    end,
    hire_date = case
      when new.hire_date is distinct from old.hire_date then excluded.hire_date
      else employee_private_profiles.hire_date
    end,
    departure_date = case
      when new.departure_date is distinct from old.departure_date then excluded.departure_date
      else employee_private_profiles.departure_date
    end;

  return new;
end;
$$;

create trigger employee_profiles_sync_private_profile
after insert or update of work_email, phone, hire_date, departure_date
on public.employee_profiles
for each row execute function public.sync_employee_profile_private_legacy_fields();

-- Public directory data stays deliberately narrow.  This no-argument function
-- derives both tenant and organization membership from the verified identity.
create or replace function public.current_employee_directory()
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
  from public.organization_members member
  join public.employee_profiles profile
    on profile.tenant_id = member.tenant_id
   and profile.organization_id = member.organization_id
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
  where member.tenant_id = (select public.current_tenant_id())
    and member.user_id = (select auth.uid())
    and member.status = 'active'
    and (
      profile.organization_member_id is null
      or target_member.status in ('active', 'invited')
    )
  order by profile.employee_no;
$$;

create or replace function public.current_employee_private_profile(
  p_employee_public_id uuid
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
  from public.employee_profiles profile
  join public.employee_private_profiles private
    on private.tenant_id = profile.tenant_id
   and private.organization_id = profile.organization_id
   and private.employee_profile_id = profile.id
  join public.organization_members viewer
    on viewer.tenant_id = profile.tenant_id
   and viewer.organization_id = profile.organization_id
   and viewer.user_id = (select auth.uid())
   and viewer.status = 'active'
  left join public.organization_members target_member
    on target_member.tenant_id = profile.tenant_id
   and target_member.organization_id = profile.organization_id
   and target_member.id = profile.organization_member_id
  where profile.tenant_id = (select public.current_tenant_id())
    and profile.public_id = p_employee_public_id
    and profile.deleted_at is null
    and (
      (
        target_member.user_id = (select auth.uid())
        and target_member.status = 'active'
        and profile.employment_status in ('probation', 'active', 'on_leave')
      )
      or (select public.has_organization_permission(profile.organization_id, 'hr.manage'))
      or (select public.has_organization_role(profile.organization_id, array['owner', 'admin']))
    );
$$;

revoke all on function public.touch_employee_private_profiles_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.sync_employee_profile_private_legacy_fields() from public, anon, authenticated, service_role;
revoke all on function public.current_employee_directory() from public, anon, authenticated, service_role;
revoke all on function public.current_employee_private_profile(uuid) from public, anon, authenticated, service_role;
grant execute on function public.current_employee_directory() to authenticated;
grant execute on function public.current_employee_private_profile(uuid) to authenticated;

-- Remove the legacy PII/classification columns from ordinary authenticated SQL
-- while retaining a safe public profile projection for existing directory use.
revoke select on table public.employee_profiles from public, anon, authenticated;
revoke select (work_email, phone, hire_date, departure_date, salary_grade_code, job_level)
  on table public.employee_profiles from public, anon, authenticated;
revoke insert, update on table public.employee_profiles from public, anon, authenticated;
grant select (
  id,
  public_id,
  tenant_id,
  organization_id,
  organization_member_id,
  employee_no,
  display_name,
  avatar_url,
  department_id,
  position_template_id,
  job_title,
  manager_employee_id,
  employment_type,
  employment_status,
  skills,
  created_at,
  updated_at,
  deleted_at
) on table public.employee_profiles to authenticated;
