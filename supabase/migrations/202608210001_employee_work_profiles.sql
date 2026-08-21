create or replace function public.valid_employee_work_labels(
  p_labels text[],
  p_maximum integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_labels is not null
    and cardinality(p_labels) <= p_maximum
    and not exists (
      select 1
      from unnest(p_labels) as label
      where label is null
        or length(btrim(label)) < 1
        or length(btrim(label)) > 40
    );
$$;

create or replace function public.valid_employee_self_skills(p_skills jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_skill jsonb;
  v_name text;
  v_level integer;
begin
  if jsonb_typeof(p_skills) <> 'array' or jsonb_array_length(p_skills) > 20 then
    return false;
  end if;
  for v_skill in select value from jsonb_array_elements(p_skills)
  loop
    if jsonb_typeof(v_skill) <> 'object' then return false; end if;
    v_name := btrim(v_skill ->> 'name');
    begin
      v_level := (v_skill ->> 'level')::integer;
    exception when others then
      return false;
    end;
    if v_name is null or length(v_name) < 1 or length(v_name) > 40
      or v_level < 1 or v_level > 5 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create table public.employee_work_profiles (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  employee_profile_id bigint not null,
  summary text not null default '' check (length(summary) <= 240),
  preferred_task_types text[] not null default '{}'
    check (public.valid_employee_work_labels(preferred_task_types, 8)),
  growth_goals text[] not null default '{}'
    check (public.valid_employee_work_labels(growth_goals, 8)),
  weekly_capacity_hours smallint not null default 40
    check (weekly_capacity_hours between 1 and 80),
  self_skills jsonb not null default '[]'::jsonb
    check (public.valid_employee_self_skills(self_skills)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_profile_id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id, employee_profile_id)
    references public.employee_profiles (tenant_id, organization_id, id)
    on delete cascade
);

create index employee_work_profiles_organization_idx
  on public.employee_work_profiles (organization_id, updated_at desc);

create or replace function public.touch_employee_work_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger employee_work_profiles_touch_updated_at
before update on public.employee_work_profiles
for each row execute function public.touch_employee_work_profile_updated_at();

alter table public.employee_work_profiles enable row level security;
alter table public.employee_work_profiles force row level security;

create policy employee_work_profiles_member_select
on public.employee_work_profiles for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.is_organization_member(organization_id))
);

create policy employee_work_profiles_self_insert
on public.employee_work_profiles for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and exists (
    select 1
    from public.employee_profiles profile
    join public.organization_members member
      on member.tenant_id = profile.tenant_id
     and member.id = profile.organization_member_id
    where profile.tenant_id = employee_work_profiles.tenant_id
      and profile.organization_id = employee_work_profiles.organization_id
      and profile.id = employee_work_profiles.employee_profile_id
      and profile.deleted_at is null
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  )
);

create policy employee_work_profiles_self_update
on public.employee_work_profiles for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and exists (
    select 1
    from public.employee_profiles profile
    join public.organization_members member
      on member.tenant_id = profile.tenant_id
     and member.id = profile.organization_member_id
    where profile.tenant_id = employee_work_profiles.tenant_id
      and profile.organization_id = employee_work_profiles.organization_id
      and profile.id = employee_work_profiles.employee_profile_id
      and profile.deleted_at is null
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  )
)
with check (
  tenant_id = (select public.current_tenant_id())
  and exists (
    select 1
    from public.employee_profiles profile
    join public.organization_members member
      on member.tenant_id = profile.tenant_id
     and member.id = profile.organization_member_id
    where profile.tenant_id = employee_work_profiles.tenant_id
      and profile.organization_id = employee_work_profiles.organization_id
      and profile.id = employee_work_profiles.employee_profile_id
      and profile.deleted_at is null
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  )
);

grant select, insert, update on public.employee_work_profiles to authenticated;
grant usage, select on sequence public.employee_work_profiles_id_seq to authenticated;

revoke execute on function public.touch_employee_work_profile_updated_at()
  from public, anon, authenticated;
