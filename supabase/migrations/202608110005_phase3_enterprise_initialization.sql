-- Phase3 enterprise initialization: company setup, positions, skills and
-- provider-neutral directory synchronization metadata.

alter table public.organizations
  add column if not exists short_name text,
  add column if not exists industry text,
  add column if not exists description text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_phase3_profile_length_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_phase3_profile_length_check check (
        (short_name is null or length(btrim(short_name)) between 1 and 80)
        and (industry is null or length(btrim(industry)) between 1 and 120)
        and (description is null or length(description) <= 1000)
      );
  end if;
end $$;

alter table public.member_roles
  add column if not exists assignment_source text not null default 'manual';

create unique index if not exists departments_tenant_organization_id_uidx
  on public.departments (tenant_id, organization_id, id);
create unique index if not exists employee_profiles_tenant_organization_id_uidx
  on public.employee_profiles (tenant_id, organization_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'member_roles_assignment_source_check'
      and conrelid = 'public.member_roles'::regclass
  ) then
    alter table public.member_roles
      add constraint member_roles_assignment_source_check
      check (assignment_source in ('manual', 'bootstrap', 'directory'));
  end if;
end $$;

create table public.tenant_initializations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'ready', 'failed')),
  current_step smallint not null default 1 check (current_step between 1 and 6),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'feishu')),
  template_key text not null default 'quantxy-v1'
    check (length(btrim(template_key)) between 1 and 80),
  template_version integer not null default 1 check (template_version > 0),
  completed_by_member_id bigint,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id),
  unique (tenant_id, id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, completed_by_member_id)
    references public.organization_members (tenant_id, id) on delete restrict,
  check (
    (status = 'ready' and completed_at is not null and completed_by_member_id is not null)
    or status <> 'ready'
  )
);

create index tenant_initializations_organization_id_idx
  on public.tenant_initializations (organization_id);
create index tenant_initializations_completed_by_member_id_idx
  on public.tenant_initializations (completed_by_member_id)
  where completed_by_member_id is not null;

create table public.position_templates (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  department_id bigint,
  code text not null check (
    code = upper(btrim(code)) and length(code) between 1 and 80
  ),
  name text not null check (length(btrim(name)) between 1 and 120),
  category text not null check (length(btrim(category)) between 1 and 80),
  description text not null default '' check (length(description) <= 1000),
  responsibilities text[] not null default '{}'::text[]
    check (cardinality(responsibilities) <= 30),
  source text not null default 'manual'
    check (source in ('manual', 'template', 'feishu')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, organization_id, id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id, department_id)
    references public.departments (tenant_id, organization_id, id)
    on delete restrict
);

create unique index position_templates_organization_code_uidx
  on public.position_templates (tenant_id, organization_id, code)
  where deleted_at is null;
create index position_templates_department_id_idx
  on public.position_templates (department_id)
  where department_id is not null and deleted_at is null;
create index position_templates_tenant_status_idx
  on public.position_templates (tenant_id, status, name)
  where deleted_at is null;

create table public.skill_categories (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  code text not null check (
    code = upper(btrim(code)) and length(code) between 1 and 80
  ),
  name text not null check (length(btrim(name)) between 1 and 120),
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, organization_id, id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade
);

create unique index skill_categories_organization_code_uidx
  on public.skill_categories (tenant_id, organization_id, code)
  where deleted_at is null;
create index skill_categories_tenant_status_idx
  on public.skill_categories (tenant_id, status, sort_order)
  where deleted_at is null;

create table public.skill_tags (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  category_id bigint not null,
  code text not null check (
    code = upper(btrim(code)) and length(code) between 1 and 80
  ),
  name text not null check (length(btrim(name)) between 1 and 120),
  aliases text[] not null default '{}'::text[] check (cardinality(aliases) <= 20),
  description text not null default '' check (length(description) <= 1000),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, organization_id, id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id, category_id)
    references public.skill_categories (tenant_id, organization_id, id)
    on delete restrict
);

create unique index skill_tags_organization_code_uidx
  on public.skill_tags (tenant_id, organization_id, code)
  where deleted_at is null;
create index skill_tags_category_id_idx
  on public.skill_tags (category_id)
  where deleted_at is null;
create index skill_tags_tenant_status_idx
  on public.skill_tags (tenant_id, status, name)
  where deleted_at is null;

create table public.position_skill_requirements (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  position_template_id bigint not null,
  skill_tag_id bigint not null,
  required_level smallint not null default 3 check (required_level between 1 and 5),
  weight numeric(5, 2) not null default 1 check (weight > 0 and weight <= 100),
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, position_template_id, skill_tag_id),
  foreign key (tenant_id, organization_id, position_template_id)
    references public.position_templates (tenant_id, organization_id, id)
    on delete cascade,
  foreign key (tenant_id, organization_id, skill_tag_id)
    references public.skill_tags (tenant_id, organization_id, id)
    on delete cascade
);

create index position_skill_requirements_position_idx
  on public.position_skill_requirements (position_template_id, weight desc);
create index position_skill_requirements_skill_idx
  on public.position_skill_requirements (skill_tag_id);

alter table public.employee_profiles
  add column if not exists position_template_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employee_profiles_tenant_position_template_fkey'
      and conrelid = 'public.employee_profiles'::regclass
  ) then
    alter table public.employee_profiles
      add constraint employee_profiles_tenant_position_template_fkey
      foreign key (tenant_id, organization_id, position_template_id)
      references public.position_templates (tenant_id, organization_id, id)
      on delete restrict;
  end if;
end $$;

create index if not exists employee_profiles_position_template_id_idx
  on public.employee_profiles (position_template_id)
  where position_template_id is not null and deleted_at is null;

create table public.employee_skills (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  employee_profile_id bigint not null,
  skill_tag_id bigint not null,
  proficiency_level smallint check (proficiency_level between 1 and 5),
  source text not null default 'self'
    check (source in ('self', 'manager', 'import', 'system')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified')),
  years_experience numeric(5, 2)
    check (years_experience is null or years_experience between 0 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_profile_id, skill_tag_id),
  foreign key (tenant_id, organization_id, employee_profile_id)
    references public.employee_profiles (tenant_id, organization_id, id)
    on delete cascade,
  foreign key (tenant_id, organization_id, skill_tag_id)
    references public.skill_tags (tenant_id, organization_id, id)
    on delete cascade
);

create index employee_skills_profile_idx
  on public.employee_skills (employee_profile_id, verification_status);
create index employee_skills_skill_idx
  on public.employee_skills (skill_tag_id, proficiency_level desc);

create table public.directory_connections (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  identity_provider_id bigint not null,
  provider_type text not null check (
    provider_type = lower(btrim(provider_type))
    and length(provider_type) between 1 and 40
  ),
  external_tenant_key text not null check (
    length(btrim(external_tenant_key)) between 1 and 200
  ),
  sync_mode text not null default 'manual' check (sync_mode = 'manual'),
  status text not null default 'active'
    check (status in ('active', 'paused', 'error')),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, identity_provider_id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, identity_provider_id)
    references public.identity_providers (tenant_id, id) on delete restrict
);

create index directory_connections_organization_id_idx
  on public.directory_connections (organization_id);
create index directory_connections_tenant_status_idx
  on public.directory_connections (tenant_id, status);

create table public.directory_entity_links (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  connection_id bigint not null,
  entity_type text not null check (
    entity_type in ('department', 'employee', 'position')
  ),
  external_id text not null check (length(btrim(external_id)) between 1 and 200),
  external_identifiers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(external_identifiers) = 'object'),
  department_id bigint,
  employee_profile_id bigint,
  position_template_id bigint,
  external_updated_at timestamptz,
  checksum text check (checksum is null or checksum ~ '^[0-9a-f]{64}$'),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, connection_id, entity_type, external_id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, connection_id)
    references public.directory_connections (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id, department_id)
    references public.departments (tenant_id, organization_id, id)
    on delete cascade,
  foreign key (tenant_id, organization_id, employee_profile_id)
    references public.employee_profiles (tenant_id, organization_id, id)
    on delete cascade,
  foreign key (tenant_id, organization_id, position_template_id)
    references public.position_templates (tenant_id, organization_id, id)
    on delete cascade,
  check (num_nonnulls(department_id, employee_profile_id, position_template_id) = 1),
  check (
    (entity_type = 'department' and department_id is not null)
    or (entity_type = 'employee' and employee_profile_id is not null)
    or (entity_type = 'position' and position_template_id is not null)
  )
);

create index directory_entity_links_department_idx
  on public.directory_entity_links (department_id)
  where department_id is not null;
create index directory_entity_links_employee_idx
  on public.directory_entity_links (employee_profile_id)
  where employee_profile_id is not null;
create index directory_entity_links_position_idx
  on public.directory_entity_links (position_template_id)
  where position_template_id is not null;
create index directory_entity_links_last_seen_idx
  on public.directory_entity_links (tenant_id, connection_id, last_seen_at);

create table public.directory_sync_runs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  connection_id bigint not null,
  actor_member_id bigint,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  snapshot_complete boolean not null default false,
  departments_seen integer not null default 0 check (departments_seen >= 0),
  employees_seen integer not null default 0 check (employees_seen >= 0),
  positions_seen integer not null default 0 check (positions_seen >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  deactivated_count integer not null default 0 check (deactivated_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, connection_id)
    references public.directory_connections (tenant_id, id) on delete cascade,
  foreign key (tenant_id, actor_member_id)
    references public.organization_members (tenant_id, id) on delete restrict,
  check ((status = 'running' and completed_at is null) or status <> 'running')
);

create index directory_sync_runs_connection_started_idx
  on public.directory_sync_runs (connection_id, started_at desc);
create index directory_sync_runs_actor_member_id_idx
  on public.directory_sync_runs (actor_member_id)
  where actor_member_id is not null;

create table public.directory_sync_issues (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  sync_run_id bigint not null,
  severity text not null check (severity in ('warning', 'error')),
  code text not null check (
    code = upper(btrim(code)) and length(code) between 1 and 80
  ),
  entity_type text,
  external_id text,
  message text not null check (length(btrim(message)) between 1 and 500),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, sync_run_id)
    references public.directory_sync_runs (tenant_id, id) on delete cascade
);

create index directory_sync_issues_run_idx
  on public.directory_sync_issues (sync_run_id, severity, created_at);

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;
alter table public.audit_logs
  add constraint audit_logs_action_check check (action in (
    'identity.provisioned',
    'identity.claimed',
    'identity.revoked',
    'member.status_changed',
    'member.role_changed',
    'profile.updated',
    'roster.imported',
    'tenant.bootstrap_owner',
    'enterprise.initialized',
    'directory.sync_started',
    'directory.sync_completed',
    'directory.sync_failed',
    'directory.role_mapped'
  ));

alter table public.tenant_initializations enable row level security;
alter table public.tenant_initializations force row level security;
alter table public.position_templates enable row level security;
alter table public.position_templates force row level security;
alter table public.skill_categories enable row level security;
alter table public.skill_categories force row level security;
alter table public.skill_tags enable row level security;
alter table public.skill_tags force row level security;
alter table public.position_skill_requirements enable row level security;
alter table public.position_skill_requirements force row level security;
alter table public.employee_skills enable row level security;
alter table public.employee_skills force row level security;
alter table public.directory_connections enable row level security;
alter table public.directory_connections force row level security;
alter table public.directory_entity_links enable row level security;
alter table public.directory_entity_links force row level security;
alter table public.directory_sync_runs enable row level security;
alter table public.directory_sync_runs force row level security;
alter table public.directory_sync_issues enable row level security;
alter table public.directory_sync_issues force row level security;

create policy tenant_initializations_member_select
on public.tenant_initializations for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy position_templates_member_select
on public.position_templates for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and deleted_at is null
);

create policy skill_categories_member_select
on public.skill_categories for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and deleted_at is null
);

create policy skill_tags_member_select
on public.skill_tags for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and deleted_at is null
);

create policy position_skill_requirements_member_select
on public.position_skill_requirements for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy employee_skills_member_select
on public.employee_skills for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

create policy employee_skills_self_or_hr_insert
on public.employee_skills for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (
    exists (
      select 1 from public.employee_profiles profile
      join public.organization_members member
        on member.tenant_id = profile.tenant_id
       and member.id = profile.organization_member_id
      where profile.tenant_id = employee_skills.tenant_id
        and profile.id = employee_skills.employee_profile_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
    )
    or (select public.has_organization_role(
      organization_id, array['owner', 'admin', 'hr']
    ))
  )
);

create policy employee_skills_self_or_hr_update
on public.employee_skills for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (
    exists (
      select 1 from public.employee_profiles profile
      join public.organization_members member
        on member.tenant_id = profile.tenant_id
       and member.id = profile.organization_member_id
      where profile.tenant_id = employee_skills.tenant_id
        and profile.id = employee_skills.employee_profile_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
    )
    or (select public.has_organization_role(
      organization_id, array['owner', 'admin', 'hr']
    ))
  )
)
with check (tenant_id = (select public.current_tenant_id()));

create policy directory_connections_admin_select
on public.directory_connections for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_organization_role(
    organization_id, array['owner', 'admin']
  ))
);

create policy directory_entity_links_admin_select
on public.directory_entity_links for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_organization_role(
    organization_id, array['owner', 'admin']
  ))
);

create policy directory_sync_runs_admin_select
on public.directory_sync_runs for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_organization_role(
    organization_id, array['owner', 'admin']
  ))
);

create policy directory_sync_issues_admin_select
on public.directory_sync_issues for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_organization_role(
    organization_id, array['owner', 'admin']
  ))
);

create or replace function public.current_tenant_initialization()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tenantId', tenant.public_id,
    'organizationId', organization.public_id,
    'status', coalesce(initialization.status, 'not_started'),
    'currentStep', coalesce(initialization.current_step, 1),
    'sourceType', coalesce(initialization.source_type, 'manual'),
    'companyName', organization.name,
    'shortName', organization.short_name,
    'industry', organization.industry,
    'description', organization.description,
    'timezone', organization.timezone,
    'completedAt', initialization.completed_at,
    'departmentCount', (
      select count(*) from public.departments department
      where department.tenant_id = tenant.id
        and department.organization_id = organization.id
        and department.status = 'active'
        and department.deleted_at is null
    ),
    'positionCount', (
      select count(*) from public.position_templates position
      where position.tenant_id = tenant.id
        and position.organization_id = organization.id
        and position.status = 'active'
        and position.deleted_at is null
    ),
    'skillCount', (
      select count(*) from public.skill_tags skill
      where skill.tenant_id = tenant.id
        and skill.organization_id = organization.id
        and skill.status = 'active'
        and skill.deleted_at is null
    )
  )
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id = tenant.id
  left join public.tenant_initializations initialization
    on initialization.tenant_id = tenant.id
   and initialization.organization_id = organization.id
  where tenant.id = (select public.current_tenant_id())
  order by organization.id
  limit 1;
$$;

create or replace function public.initialize_current_enterprise(
  p_company_name text,
  p_short_name text,
  p_industry text,
  p_description text,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint := (select public.current_tenant_id());
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_management_department_id bigint;
  v_ceo_position_id bigint;
  v_department_count bigint;
  v_position_count bigint;
  v_skill_count bigint;
begin
  if v_tenant_id is null then
    raise exception 'Authenticated enterprise identity is required'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_company_name), '') is null
     or length(btrim(p_company_name)) > 120
     or nullif(btrim(p_short_name), '') is null
     or length(btrim(p_short_name)) > 80
     or nullif(btrim(p_industry), '') is null
     or length(btrim(p_industry)) > 120
     or length(coalesce(p_description, '')) > 1000
     or not exists (
       select 1 from pg_catalog.pg_timezone_names timezone
       where timezone.name = p_timezone
     ) then
    raise exception 'Enterprise initialization fields are invalid'
      using errcode = '22023';
  end if;

  select organization.id, member.id
  into strict v_organization_id, v_actor_member_id
  from public.organizations organization
  join public.organization_members member
    on member.tenant_id = organization.tenant_id
   and member.organization_id = organization.id
   and member.user_id = (select auth.uid())
   and member.status = 'active'
  where organization.tenant_id = v_tenant_id
  order by organization.id
  limit 1;

  if not public.has_organization_role(
    v_organization_id, array['owner']::text[]
  ) then
    raise exception 'Only an owner can initialize the enterprise'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('enterprise-initialization:' || v_tenant_id::text, 0)
  );

  update public.tenants
  set name = btrim(p_company_name), updated_at = now()
  where id = v_tenant_id;

  update public.organizations
  set name = btrim(p_company_name),
      short_name = btrim(p_short_name),
      industry = btrim(p_industry),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      timezone = p_timezone,
      updated_at = now()
  where tenant_id = v_tenant_id and id = v_organization_id;

  insert into public.departments (
    tenant_id, organization_id, code, name, description, sort_order,
    status, deleted_at
  ) values
    (v_tenant_id, v_organization_id, 'MGT', '管理中心', '公司经营与组织管理', 10, 'active', null),
    (v_tenant_id, v_organization_id, 'AI_RND', 'AI研发部', '人工智能产品研发与技术交付', 20, 'active', null),
    (v_tenant_id, v_organization_id, 'PRODUCT_OPS', '产品运营部', '产品规划、内容与用户运营', 30, 'active', null),
    (v_tenant_id, v_organization_id, 'GROWTH', '商业增长部', '市场、销售与商业增长', 40, 'active', null),
    (v_tenant_id, v_organization_id, 'FIN_ADMIN', '财务行政部', '财务、人事与行政支持', 50, 'active', null)
  on conflict (organization_id, code) where deleted_at is null
  do update set
    name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    status = 'active';

  select department.id into strict v_management_department_id
  from public.departments department
  where department.tenant_id = v_tenant_id
    and department.organization_id = v_organization_id
    and department.code = 'MGT'
    and department.deleted_at is null;

  update public.employee_profiles profile
  set department_id = v_management_department_id,
      job_title = 'CEO',
      updated_at = now()
  where profile.tenant_id = v_tenant_id
    and profile.organization_id = v_organization_id
    and profile.organization_member_id = v_actor_member_id
    and profile.deleted_at is null;

  update public.departments legacy
  set status = 'inactive', updated_at = now()
  where legacy.tenant_id = v_tenant_id
    and legacy.organization_id = v_organization_id
    and legacy.code in ('AI', 'ECOM', 'OPS', 'FIN', 'HR')
    and legacy.deleted_at is null
    and not exists (
      select 1 from public.employee_profiles profile
      where profile.tenant_id = legacy.tenant_id
        and profile.department_id = legacy.id
        and profile.deleted_at is null
        and profile.employment_status <> 'departed'
    );

  insert into public.position_templates (
    tenant_id, organization_id, department_id, code, name, category,
    description, responsibilities, source, status, deleted_at
  )
  select
    v_tenant_id,
    v_organization_id,
    department.id,
    seed.code,
    seed.name,
    seed.category,
    seed.description,
    seed.responsibilities,
    'template',
    'active',
    null
  from (values
    ('CEO', 'CEO', '管理', '负责公司方向、资源与最终决策', array['经营目标', '资源配置', '结果验收']::text[], 'MGT'),
    ('DEPARTMENT_HEAD', '部门负责人', '管理', '负责部门目标、项目和人员协同', array['目标承接', '任务分配', '成果验收']::text[], null),
    ('PRODUCT_MANAGER', '产品经理', '产品', '负责需求、方案与交付协同', array['需求分析', '产品设计', '项目推进']::text[], 'PRODUCT_OPS'),
    ('AI_ENGINEER', 'AI工程师', '技术', '负责AI应用研发与交付', array['模型应用', '服务开发', '效果验证']::text[], 'AI_RND'),
    ('FRONTEND_ENGINEER', '前端工程师', '技术', '负责企业产品前端开发', array['界面开发', '交互实现', '质量保障']::text[], 'AI_RND'),
    ('BACKEND_ENGINEER', '后端工程师', '技术', '负责服务端与数据能力', array['服务开发', '数据建模', '系统安全']::text[], 'AI_RND'),
    ('QA_ENGINEER', '测试工程师', '技术', '负责产品质量验证', array['测试设计', '缺陷跟踪', '验收保障']::text[], 'AI_RND'),
    ('CONTENT_OPERATIONS', '内容运营', '运营', '负责内容策划与发布', array['内容策划', '渠道运营', '数据复盘']::text[], 'PRODUCT_OPS'),
    ('COMMERCE_GROWTH', '商业增长', '增长', '负责市场与商业转化', array['市场分析', '客户增长', '收入转化']::text[], 'GROWTH'),
    ('FINANCE', '财务', '支持', '负责预算、成本与经营分析', array['预算管理', '财务分析', '风险控制']::text[], 'FIN_ADMIN'),
    ('HR', '人力资源', '支持', '负责招聘、组织与员工服务', array['招聘配置', '人才发展', '员工服务']::text[], 'FIN_ADMIN'),
    ('ADMINISTRATION', '行政', '支持', '负责行政与办公支持', array['行政管理', '资产管理', '办公支持']::text[], 'FIN_ADMIN')
  ) as seed(code, name, category, description, responsibilities, department_code)
  left join public.departments department
    on department.tenant_id = v_tenant_id
   and department.organization_id = v_organization_id
   and department.code = seed.department_code
   and department.deleted_at is null
  on conflict (tenant_id, organization_id, code) where deleted_at is null
  do update set
    department_id = excluded.department_id,
    name = excluded.name,
    category = excluded.category,
    description = excluded.description,
    responsibilities = excluded.responsibilities,
    source = excluded.source,
    status = 'active',
    updated_at = now();

  insert into public.skill_categories (
    tenant_id, organization_id, code, name, sort_order, status, deleted_at
  ) values
    (v_tenant_id, v_organization_id, 'STRATEGY', '战略管理', 10, 'active', null),
    (v_tenant_id, v_organization_id, 'PROJECT', '项目管理', 20, 'active', null),
    (v_tenant_id, v_organization_id, 'PRODUCT', '产品能力', 30, 'active', null),
    (v_tenant_id, v_organization_id, 'TECHNOLOGY', '技术能力', 40, 'active', null),
    (v_tenant_id, v_organization_id, 'OPERATIONS', '运营增长', 50, 'active', null),
    (v_tenant_id, v_organization_id, 'FINANCE', '财务能力', 60, 'active', null),
    (v_tenant_id, v_organization_id, 'PEOPLE', '人力资源', 70, 'active', null),
    (v_tenant_id, v_organization_id, 'COLLABORATION', '通用协作', 80, 'active', null)
  on conflict (tenant_id, organization_id, code) where deleted_at is null
  do update set
    name = excluded.name,
    sort_order = excluded.sort_order,
    status = 'active',
    updated_at = now();

  insert into public.skill_tags (
    tenant_id, organization_id, category_id, code, name, aliases,
    description, status, deleted_at
  )
  select
    v_tenant_id,
    v_organization_id,
    category.id,
    seed.code,
    seed.name,
    seed.aliases,
    seed.description,
    'active',
    null
  from (values
    ('STRATEGY_PLANNING', '战略规划', array['战略']::text[], '制定和校准企业经营方向', 'STRATEGY'),
    ('GOAL_BREAKDOWN', '目标拆解', array['目标管理']::text[], '把企业目标拆成可执行结果', 'STRATEGY'),
    ('BUDGET_PLANNING', '预算规划', array['预算']::text[], '规划资源和预算边界', 'STRATEGY'),
    ('PROJECT_MANAGEMENT', '项目管理', array['项目推进']::text[], '规划并推动项目按期交付', 'PROJECT'),
    ('RISK_MANAGEMENT', '风险管理', array['风险控制']::text[], '识别、跟踪和关闭风险', 'PROJECT'),
    ('PRODUCT_DESIGN', '产品设计', array['产品策划']::text[], '完成需求和产品方案设计', 'PRODUCT'),
    ('USER_RESEARCH', '用户研究', array['用户洞察']::text[], '理解用户需求并验证方案', 'PRODUCT'),
    ('LLM_APPLICATION', '大模型应用', array['AI应用']::text[], '构建和交付大模型应用', 'TECHNOLOGY'),
    ('PROMPT_ENGINEERING', '提示词设计', array['Prompt']::text[], '设计和评估提示词流程', 'TECHNOLOGY'),
    ('FRONTEND_DEVELOPMENT', '前端开发', array['React']::text[], '开发企业级前端产品', 'TECHNOLOGY'),
    ('BACKEND_DEVELOPMENT', '后端开发', array['API']::text[], '开发安全稳定的服务端能力', 'TECHNOLOGY'),
    ('DATA_ANALYSIS', '数据分析', array['经营分析']::text[], '使用数据支持业务决策', 'TECHNOLOGY'),
    ('TESTING', '测试验证', array['质量保障']::text[], '设计测试并验证交付质量', 'TECHNOLOGY'),
    ('CONTENT_PLANNING', '内容策划', array['内容运营']::text[], '规划内容主题和生产节奏', 'OPERATIONS'),
    ('ECOMMERCE_OPERATIONS', '电商运营', array['电商增长']::text[], '运营电商渠道并提升转化', 'OPERATIONS'),
    ('GROWTH_OPERATIONS', '增长运营', array['增长']::text[], '设计和执行增长方案', 'OPERATIONS'),
    ('FINANCIAL_ANALYSIS', '财务分析', array['财务']::text[], '分析收入、成本和利润', 'FINANCE'),
    ('RECRUITING', '招聘配置', array['招聘']::text[], '识别并配置所需人才', 'PEOPLE'),
    ('COMMUNICATION', '沟通协作', array['协作']::text[], '清晰同步信息和推进共识', 'COLLABORATION'),
    ('DOCUMENTATION', '文档编写', array['文档']::text[], '沉淀结构化工作文档', 'COLLABORATION')
  ) as seed(code, name, aliases, description, category_code)
  join public.skill_categories category
    on category.tenant_id = v_tenant_id
   and category.organization_id = v_organization_id
   and category.code = seed.category_code
   and category.deleted_at is null
  on conflict (tenant_id, organization_id, code) where deleted_at is null
  do update set
    category_id = excluded.category_id,
    name = excluded.name,
    aliases = excluded.aliases,
    description = excluded.description,
    status = 'active',
    updated_at = now();

  insert into public.position_skill_requirements (
    tenant_id, organization_id, position_template_id, skill_tag_id,
    required_level, weight, is_required
  )
  select
    v_tenant_id,
    v_organization_id,
    position.id,
    skill.id,
    seed.required_level,
    seed.weight,
    seed.is_required
  from (values
    ('CEO', 'STRATEGY_PLANNING', 4::smallint, 30::numeric, true),
    ('CEO', 'GOAL_BREAKDOWN', 4::smallint, 30::numeric, true),
    ('DEPARTMENT_HEAD', 'PROJECT_MANAGEMENT', 4::smallint, 35::numeric, true),
    ('AI_ENGINEER', 'LLM_APPLICATION', 4::smallint, 35::numeric, true),
    ('AI_ENGINEER', 'BACKEND_DEVELOPMENT', 3::smallint, 20::numeric, false),
    ('PRODUCT_MANAGER', 'PRODUCT_DESIGN', 4::smallint, 35::numeric, true),
    ('CONTENT_OPERATIONS', 'CONTENT_PLANNING', 4::smallint, 35::numeric, true),
    ('COMMERCE_GROWTH', 'GROWTH_OPERATIONS', 4::smallint, 35::numeric, true),
    ('FINANCE', 'FINANCIAL_ANALYSIS', 4::smallint, 40::numeric, true),
    ('HR', 'RECRUITING', 4::smallint, 35::numeric, true)
  ) as seed(position_code, skill_code, required_level, weight, is_required)
  join public.position_templates position
    on position.tenant_id = v_tenant_id
   and position.organization_id = v_organization_id
   and position.code = seed.position_code
   and position.deleted_at is null
  join public.skill_tags skill
    on skill.tenant_id = v_tenant_id
   and skill.organization_id = v_organization_id
   and skill.code = seed.skill_code
   and skill.deleted_at is null
  on conflict (tenant_id, position_template_id, skill_tag_id)
  do update set
    required_level = excluded.required_level,
    weight = excluded.weight,
    is_required = excluded.is_required,
    updated_at = now();

  select position.id into strict v_ceo_position_id
  from public.position_templates position
  where position.tenant_id = v_tenant_id
    and position.organization_id = v_organization_id
    and position.code = 'CEO'
    and position.deleted_at is null;

  update public.employee_profiles profile
  set position_template_id = v_ceo_position_id,
      updated_at = now()
  where profile.tenant_id = v_tenant_id
    and profile.organization_member_id = v_actor_member_id
    and profile.deleted_at is null;

  insert into public.tenant_initializations (
    tenant_id, organization_id, status, current_step, source_type,
    template_key, template_version, completed_by_member_id, completed_at
  ) values (
    v_tenant_id, v_organization_id, 'ready', 6, 'manual',
    'quantxy-v1', 1, v_actor_member_id, now()
  )
  on conflict (tenant_id) do update set
    organization_id = excluded.organization_id,
    status = 'ready',
    current_step = 6,
    completed_by_member_id = excluded.completed_by_member_id,
    completed_at = coalesce(
      public.tenant_initializations.completed_at,
      excluded.completed_at
    ),
    updated_at = now();

  select count(*) into v_department_count
  from public.departments department
  where department.tenant_id = v_tenant_id
    and department.organization_id = v_organization_id
    and department.status = 'active'
    and department.deleted_at is null;

  select count(*) into v_position_count
  from public.position_templates position
  where position.tenant_id = v_tenant_id
    and position.organization_id = v_organization_id
    and position.status = 'active'
    and position.deleted_at is null;

  select count(*) into v_skill_count
  from public.skill_tags skill
  where skill.tenant_id = v_tenant_id
    and skill.organization_id = v_organization_id
    and skill.status = 'active'
    and skill.deleted_at is null;

  perform public.append_audit_log(
    v_tenant_id,
    v_organization_id,
    (select auth.uid()),
    v_actor_member_id,
    'enterprise.initialized',
    'tenant_initialization',
    v_tenant_id::text,
    null,
    null,
    jsonb_build_object(
      'template', 'quantxy-v1',
      'departments', v_department_count,
      'positions', v_position_count,
      'skills', v_skill_count
    )
  );

  return jsonb_build_object(
    'status', 'ready',
    'departmentCount', v_department_count,
    'positionCount', v_position_count,
    'skillCount', v_skill_count
  );
end;
$$;

revoke all on function public.current_tenant_initialization()
  from public, anon;
grant execute on function public.current_tenant_initialization()
  to authenticated;

revoke all on function public.initialize_current_enterprise(
  text, text, text, text, text
) from public, anon;
grant execute on function public.initialize_current_enterprise(
  text, text, text, text, text
) to authenticated;

grant select on public.tenant_initializations,
  public.position_templates,
  public.skill_categories,
  public.skill_tags,
  public.position_skill_requirements,
  public.employee_skills,
  public.directory_connections,
  public.directory_entity_links,
  public.directory_sync_runs,
  public.directory_sync_issues
to authenticated;

grant insert, update on public.employee_skills to authenticated;
grant usage, select on sequence public.employee_skills_id_seq to authenticated;
