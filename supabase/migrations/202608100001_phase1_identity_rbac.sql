create table public.tenants (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  name text not null check (length(btrim(name)) > 0),
  slug text not null unique check (slug = lower(btrim(slug)) and length(slug) > 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.tenants (name, slug, status)
values ('量子星河', 'quantxy', 'active')
on conflict (slug) do update
set name = excluded.name,
    status = excluded.status,
    updated_at = now();

alter table public.organizations
  add column tenant_id bigint;

update public.organizations organization
set tenant_id = tenant.id
from public.tenants tenant
where tenant.slug = 'quantxy'
  and organization.tenant_id is null;

alter table public.organizations
  alter column tenant_id set not null,
  add constraint organizations_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  add constraint organizations_tenant_id_id_key unique (tenant_id, id);

alter table public.organizations drop constraint organizations_slug_key;
alter table public.organizations
  add constraint organizations_tenant_slug_key unique (tenant_id, slug);

insert into public.organizations (tenant_id, name, slug)
select tenant.id, seed.name, seed.slug
from public.tenants tenant
cross join (values ('量子星河', 'quantum-galaxy')) as seed(name, slug)
where tenant.slug = 'quantxy'
on conflict (tenant_id, slug) do update
set name = excluded.name,
    updated_at = now();

alter table public.organization_members
  add column tenant_id bigint;

update public.organization_members member
set tenant_id = organization.tenant_id
from public.organizations organization
where organization.id = member.organization_id;

alter table public.organization_members
  alter column tenant_id set not null,
  alter column user_id drop not null,
  add constraint organization_members_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  add constraint organization_members_tenant_id_id_key unique (tenant_id, id),
  add constraint organization_members_tenant_organization_fkey
    foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade;

create unique index organization_members_tenant_user_idx
  on public.organization_members (tenant_id, user_id)
  where user_id is not null;

alter table public.roles
  add column tenant_id bigint;

update public.roles role
set tenant_id = coalesce(
  (
    select organization.tenant_id
    from public.organizations organization
    where organization.id = role.organization_id
  ),
  (
    select tenant.id
    from public.tenants tenant
    where tenant.slug = 'quantxy'
  )
);

alter table public.roles
  alter column tenant_id set not null,
  add constraint roles_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  add constraint roles_tenant_id_id_key unique (tenant_id, id),
  add constraint roles_tenant_organization_fkey
    foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade;

drop index public.roles_system_code_idx;
drop index public.roles_organization_code_idx;
create unique index roles_tenant_system_code_idx
  on public.roles (tenant_id, code)
  where organization_id is null;
create unique index roles_tenant_organization_code_idx
  on public.roles (tenant_id, organization_id, code)
  where organization_id is not null;

alter table public.member_roles
  add column tenant_id bigint;

update public.member_roles assignment
set tenant_id = member.tenant_id
from public.organization_members member
where member.id = assignment.member_id;

alter table public.member_roles
  alter column tenant_id set not null,
  add constraint member_roles_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  add constraint member_roles_tenant_member_fkey
    foreign key (tenant_id, member_id)
    references public.organization_members (tenant_id, id) on delete cascade,
  add constraint member_roles_tenant_role_fkey
    foreign key (tenant_id, role_id)
    references public.roles (tenant_id, id) on delete cascade,
  add constraint member_roles_tenant_assignment_key
    unique (tenant_id, member_id, role_id);

alter table public.role_permissions
  add column tenant_id bigint;

update public.role_permissions assignment
set tenant_id = role.tenant_id
from public.roles role
where role.id = assignment.role_id;

alter table public.role_permissions
  alter column tenant_id set not null,
  add constraint role_permissions_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  add constraint role_permissions_tenant_role_fkey
    foreign key (tenant_id, role_id)
    references public.roles (tenant_id, id) on delete cascade,
  add constraint role_permissions_tenant_assignment_key
    unique (tenant_id, role_id, permission_id);

alter table public.departments
  add column tenant_id bigint,
  add column description text,
  add column leader_member_id bigint;

update public.departments department
set tenant_id = organization.tenant_id
from public.organizations organization
where organization.id = department.organization_id;

alter table public.departments
  alter column tenant_id set not null,
  add constraint departments_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  add constraint departments_tenant_id_id_key unique (tenant_id, id),
  add constraint departments_tenant_organization_fkey
    foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  add constraint departments_tenant_parent_fkey
    foreign key (tenant_id, parent_department_id)
    references public.departments (tenant_id, id) on delete restrict,
  add constraint departments_tenant_leader_fkey
    foreign key (tenant_id, leader_member_id)
    references public.organization_members (tenant_id, id) on delete restrict;

alter table public.employee_profiles
  add column tenant_id bigint,
  add column skills text[] not null default '{}'::text[];

update public.employee_profiles profile
set tenant_id = organization.tenant_id
from public.organizations organization
where organization.id = profile.organization_id;

alter table public.employee_profiles
  alter column tenant_id set not null,
  add constraint employee_profiles_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  add constraint employee_profiles_tenant_id_id_key unique (tenant_id, id),
  add constraint employee_profiles_tenant_organization_fkey
    foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  add constraint employee_profiles_tenant_member_fkey
    foreign key (tenant_id, organization_member_id)
    references public.organization_members (tenant_id, id) on delete no action,
  add constraint employee_profiles_tenant_department_fkey
    foreign key (tenant_id, department_id)
    references public.departments (tenant_id, id) on delete no action,
  add constraint employee_profiles_tenant_manager_fkey
    foreign key (tenant_id, manager_employee_id)
    references public.employee_profiles (tenant_id, id) on delete no action;

create or replace function public.normalize_employee_skills()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.skills is null then
    raise exception 'Skills must be an array' using errcode = '22023';
  end if;
  if cardinality(new.skills) > 30 then
    raise exception 'Skills cannot contain more than 30 items' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(new.skills) as skill
    where skill is null
      or length(btrim(skill)) not between 1 and 40
  ) then
    raise exception 'Skills must contain 1 to 40 characters' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct lower(btrim(skill))), '{}'::text[])
  into new.skills
  from unnest(new.skills) as skill;
  return new;
end;
$$;

create trigger employee_profiles_normalize_skills
before insert or update of skills on public.employee_profiles
for each row execute function public.normalize_employee_skills();

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
    select 1 from public.departments parent
    where parent.tenant_id = new.tenant_id
      and parent.id = new.parent_department_id
      and parent.organization_id = new.organization_id
      and parent.deleted_at is null
  ) then
    raise exception 'Parent department must belong to the same tenant and organization' using errcode = '23514';
  end if;
  if exists (
    with recursive ancestors as (
      select department.id, department.parent_department_id
      from public.departments department
      where department.tenant_id = new.tenant_id
        and department.id = new.parent_department_id
      union all
      select parent.id, parent.parent_department_id
      from public.departments parent
      join ancestors on ancestors.parent_department_id = parent.id
      where parent.tenant_id = new.tenant_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'Department hierarchy cannot contain a cycle' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_department_leader()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.leader_member_id is not null and not exists (
    select 1 from public.organization_members member
    where member.tenant_id = new.tenant_id
      and member.id = new.leader_member_id
      and member.organization_id = new.organization_id
      and member.status in ('invited', 'active')
  ) then
    raise exception 'Department leader must belong to the same tenant and organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger departments_guard_leader
before insert or update of tenant_id, organization_id, leader_member_id
on public.departments
for each row execute function public.guard_department_leader();

create or replace function public.guard_employee_profile_relations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_member_id is not null and not exists (
    select 1 from public.organization_members member
    where member.tenant_id = new.tenant_id
      and member.id = new.organization_member_id
      and member.organization_id = new.organization_id
  ) then
    raise exception 'Organization member must belong to the same tenant and organization' using errcode = '23514';
  end if;
  if new.department_id is not null and not exists (
    select 1 from public.departments department
    where department.tenant_id = new.tenant_id
      and department.id = new.department_id
      and department.organization_id = new.organization_id
      and department.deleted_at is null
  ) then
    raise exception 'Department must belong to the same tenant and organization' using errcode = '23514';
  end if;
  if new.manager_employee_id is not null then
    if new.manager_employee_id = new.id then
      raise exception 'An employee cannot manage themselves' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.employee_profiles manager
      where manager.tenant_id = new.tenant_id
        and manager.id = new.manager_employee_id
        and manager.organization_id = new.organization_id
        and manager.deleted_at is null
    ) then
      raise exception 'Manager must belong to the same tenant and organization' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.jsonb_has_sensitive_key(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null then
    return false;
  end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      if v_key ~* '(token|secret|authorization|code|cookie|service_role)' then
        return true;
      end if;
      if public.jsonb_has_sensitive_key(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.jsonb_has_sensitive_key(v_child) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

create table public.identity_providers (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  provider_code text not null check (provider_code = lower(btrim(provider_code)) and length(provider_code) > 0),
  auth_provider text not null check (length(btrim(auth_provider)) > 0),
  provider_tenant_key text not null check (length(btrim(provider_tenant_key)) > 0),
  display_name text not null check (length(btrim(display_name)) > 0),
  status text not null default 'active' check (status in ('active', 'disabled')),
  safe_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_metadata) = 'object' and not public.jsonb_has_sensitive_key(safe_metadata)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider_code),
  unique (tenant_id, auth_provider),
  unique (tenant_id, provider_code, provider_tenant_key),
  unique (auth_provider, provider_tenant_key)
);

insert into public.identity_providers (
  tenant_id, provider_code, auth_provider, provider_tenant_key, display_name, status
)
select tenant.id, seed.provider_code, seed.auth_provider, seed.provider_tenant_key, seed.display_name, 'active'
from public.tenants tenant
cross join (values ('feishu', 'custom:feishu', 'tenant_qxy', '飞书'))
  as seed(provider_code, auth_provider, provider_tenant_key, display_name)
where tenant.slug = 'quantxy'
on conflict (tenant_id, provider_code) do update
set auth_provider = excluded.auth_provider,
    provider_tenant_key = excluded.provider_tenant_key,
    display_name = excluded.display_name,
    status = 'active',
    updated_at = now();

create table public.external_identities (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  organization_member_id bigint not null,
  identity_provider_id bigint not null,
  provider_subject text,
  provider_tenant_key text not null check (length(btrim(provider_tenant_key)) > 0),
  provider_match_keys text[] not null default '{}'::text[],
  verified_email text,
  auth_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, identity_provider_id, organization_member_id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_member_id)
    references public.organization_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, identity_provider_id)
    references public.identity_providers (tenant_id, id) on delete cascade,
  check (
    nullif(btrim(provider_subject), '') is not null
    or cardinality(provider_match_keys) > 0
    or nullif(btrim(verified_email), '') is not null
  )
);

create unique index external_identities_provider_subject_idx
  on public.external_identities (
    tenant_id, identity_provider_id, provider_tenant_key, provider_subject
  )
  where provider_subject is not null;
create unique index external_identities_auth_user_idx
  on public.external_identities (auth_user_id)
  where auth_user_id is not null;
create index external_identities_match_keys_idx
  on public.external_identities using gin (provider_match_keys);

create or replace function public.normalize_external_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.provider_subject := nullif(btrim(new.provider_subject), '');
  new.provider_tenant_key := btrim(new.provider_tenant_key);
  new.verified_email := nullif(lower(btrim(new.verified_email)), '');
  if new.provider_match_keys is null then
    raise exception 'Provider match keys must be an array' using errcode = '22023';
  end if;
  if cardinality(new.provider_match_keys) > 30 then
    raise exception 'Provider match keys cannot contain more than 30 items' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(new.provider_match_keys) as match_key
    where length(btrim(match_key)) not between 1 and 200
  ) then
    raise exception 'Provider match keys are invalid' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct lower(btrim(match_key))), '{}'::text[])
  into new.provider_match_keys
  from unnest(new.provider_match_keys) as match_key;
  new.updated_at := now();
  return new;
end;
$$;

create trigger external_identities_normalize
before insert or update on public.external_identities
for each row execute function public.normalize_external_identity();

create or replace function public.guard_external_identity_relations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_members member
    where member.tenant_id = new.tenant_id
      and member.id = new.organization_member_id
      and member.organization_id = new.organization_id
  ) then
    raise exception 'External identity member must belong to its tenant and organization' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.identity_providers provider
    where provider.tenant_id = new.tenant_id
      and provider.id = new.identity_provider_id
      and provider.provider_tenant_key = new.provider_tenant_key
  ) then
    raise exception 'External identity provider tenant key is invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger external_identities_guard_relations
before insert or update of tenant_id, organization_id, organization_member_id,
  identity_provider_id, provider_tenant_key
on public.external_identities
for each row execute function public.guard_external_identity_relations();

create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint,
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  actor_member_id bigint,
  action text not null check (action in (
    'identity.provisioned',
    'identity.claimed',
    'identity.revoked',
    'member.status_changed',
    'member.role_changed',
    'profile.updated',
    'roster.imported'
  )),
  target_type text not null check (length(btrim(target_type)) between 1 and 80),
  target_id text,
  request_id uuid,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, actor_member_id)
    references public.organization_members (tenant_id, id) on delete restrict
);

create index audit_logs_tenant_created_at_idx
  on public.audit_logs (tenant_id, created_at desc);

create or replace function public.append_audit_log(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_auth_user_id uuid,
  p_actor_member_id bigint,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_request_id uuid,
  p_ip_hash text,
  p_metadata jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_id bigint;
begin
  p_metadata := coalesce(p_metadata, '{}'::jsonb);
  if jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Audit metadata must be an object' using errcode = '22023';
  end if;
  if octet_length(p_metadata::text) > 8192 then
    raise exception 'Audit metadata exceeds 8192 bytes' using errcode = '22023';
  end if;
  if public.jsonb_has_sensitive_key(p_metadata) then
    raise exception 'Audit metadata contains a sensitive key' using errcode = '22023';
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Only an IP HMAC or hash digest may be stored' using errcode = '22023';
  end if;
  if p_actor_auth_user_id is not null or p_actor_member_id is not null then
    if p_actor_auth_user_id is null
       or p_actor_member_id is null
       or not exists (
         select 1
         from public.organization_members member
         where member.tenant_id = p_tenant_id
           and member.id = p_actor_member_id
           and member.user_id = p_actor_auth_user_id
           and member.status = 'active'
       ) then
      raise exception 'Audit actor must be bound to the same tenant and member' using errcode = '23514';
    end if;
  end if;

  insert into public.audit_logs (
    tenant_id, organization_id, actor_auth_user_id, actor_member_id,
    action, target_type, target_id, request_id, ip_hash, metadata
  ) values (
    p_tenant_id, p_organization_id, p_actor_auth_user_id, p_actor_member_id,
    p_action, btrim(p_target_type), p_target_id, p_request_id, p_ip_hash, p_metadata
  )
  returning id into v_audit_id;
  return v_audit_id;
end;
$$;

create or replace function public.reject_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit logs are append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_append_only
before update or delete on public.audit_logs
for each row execute function public.reject_audit_log_mutation();

create or replace function public.audit_member_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_member_id bigint;
begin
  if old.status is distinct from new.status then
    select member.id into v_actor_member_id
    from public.organization_members member
    where member.tenant_id = new.tenant_id
      and member.user_id = (select auth.uid())
    limit 1;
    perform public.append_audit_log(
      new.tenant_id, new.organization_id, (select auth.uid()), v_actor_member_id,
      'member.status_changed', 'organization_member', new.id::text,
      null, null, jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger organization_members_audit_status
after update of status on public.organization_members
for each row execute function public.audit_member_status_change();

create or replace function public.audit_member_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.member_roles%rowtype;
  v_organization_id bigint;
  v_actor_member_id bigint;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  select member.organization_id into v_organization_id
  from public.organization_members member
  where member.tenant_id = v_row.tenant_id and member.id = v_row.member_id;
  select member.id into v_actor_member_id
  from public.organization_members member
  where member.tenant_id = v_row.tenant_id
    and member.user_id = (select auth.uid())
  limit 1;
  perform public.append_audit_log(
    v_row.tenant_id, v_organization_id, (select auth.uid()), v_actor_member_id,
    'member.role_changed', 'organization_member', v_row.member_id::text,
    null, null, jsonb_build_object('operation', lower(tg_op), 'role_id', v_row.role_id)
  );
  return v_row;
end;
$$;

create trigger member_roles_audit_change
after insert or delete on public.member_roles
for each row execute function public.audit_member_role_change();

create or replace function public.audit_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_member_id bigint;
begin
  select member.id into v_actor_member_id
  from public.organization_members member
  where member.tenant_id = new.tenant_id
    and member.user_id = (select auth.uid())
  limit 1;
  perform public.append_audit_log(
    new.tenant_id, new.organization_id, (select auth.uid()), v_actor_member_id,
    'profile.updated', 'employee_profile', new.id::text,
    null, null, '{}'::jsonb
  );
  return new;
end;
$$;

create trigger employee_profiles_audit_update
after update on public.employee_profiles
for each row execute function public.audit_profile_update();

create or replace function public.audit_identity_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_member_id bigint;
begin
  if old.status is distinct from new.status and new.status = 'revoked' then
    select member.id into v_actor_member_id
    from public.organization_members member
    where member.tenant_id = new.tenant_id
      and member.user_id = (select auth.uid())
    limit 1;
    perform public.append_audit_log(
      new.tenant_id, new.organization_id, (select auth.uid()), v_actor_member_id,
      'identity.revoked', 'external_identity', new.id::text,
      null, null, '{}'::jsonb
    );
  end if;
  return new;
end;
$$;

create trigger external_identities_audit_revocation
after update of status on public.external_identities
for each row execute function public.audit_identity_revocation();

with company as (
  select organization.tenant_id, organization.id
  from public.organizations organization
  join public.tenants tenant on tenant.id = organization.tenant_id
  where tenant.slug = 'quantxy' and organization.slug = 'quantum-galaxy'
)
insert into public.departments (
  tenant_id, organization_id, code, name, description, sort_order
)
select company.tenant_id, company.id, seed.code, seed.name, seed.description, seed.sort_order
from company
cross join (values
  ('AI', 'AI事业部', 'AI产品、研发与交付', 10),
  ('ECOM', '电商事业部', '电商业务增长与履约', 20),
  ('OPS', '运营部', '品牌、内容与业务运营', 30),
  ('FIN', '财务部', '预算、成本、收入与资金', 40),
  ('HR', '人力资源部', '组织、人才与员工服务', 50)
) as seed(code, name, description, sort_order)
on conflict (organization_id, code) where deleted_at is null
do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order;

insert into public.role_permissions (tenant_id, role_id, permission_id)
select role.tenant_id, role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.organization_id is null and role.code in ('owner', 'admin')
on conflict do nothing;

with matrix(role_code, permission_code) as (values
  ('department_head', 'department.manage'), ('department_head', 'project.manage'),
  ('department_head', 'task.manage'), ('department_head', 'attendance.self'),
  ('department_head', 'attendance.manage'), ('department_head', 'approval.self'),
  ('department_head', 'approval.manage'), ('department_head', 'files.manage'),
  ('employee', 'task.manage'), ('employee', 'attendance.self'),
  ('employee', 'salary.self'), ('employee', 'approval.self'), ('employee', 'files.manage'),
  ('finance', 'salary.manage'), ('finance', 'attendance.self'),
  ('finance', 'approval.self'), ('finance', 'approval.manage'), ('finance', 'files.manage'),
  ('hr', 'hr.manage'), ('hr', 'attendance.self'), ('hr', 'attendance.manage'),
  ('hr', 'salary.self'), ('hr', 'salary.manage'), ('hr', 'approval.self'),
  ('hr', 'approval.manage'), ('hr', 'files.manage')
)
insert into public.role_permissions (tenant_id, role_id, permission_id)
select role.tenant_id, role.id, permission.id
from matrix
join public.roles role on role.code = matrix.role_code and role.organization_id is null
join public.permissions permission on permission.code = matrix.permission_code
on conflict do nothing;

create or replace function public.provision_employee_identity(
  p_tenant_slug text,
  p_organization_slug text,
  p_employee_no text,
  p_display_name text,
  p_department_code text,
  p_job_title text,
  p_role_code text,
  p_provider_code text,
  p_provider_tenant_key text,
  p_provider_subject text,
  p_provider_match_keys text[] default '{}'::text[],
  p_skills text[] default '{}'::text[],
  p_work_email text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
  v_department_id bigint;
  v_role_id bigint;
  v_member_id bigint;
  v_profile_id bigint;
  v_identity_provider_id bigint;
  v_external_id bigint;
begin
  if p_role_code not in ('owner', 'department_head', 'employee', 'finance', 'hr') then
    raise exception 'Unsupported workspace role' using errcode = '22023';
  end if;
  if nullif(btrim(p_employee_no), '') is null
     or nullif(btrim(p_display_name), '') is null
     or nullif(btrim(p_provider_tenant_key), '') is null
     or (
       nullif(btrim(p_provider_subject), '') is null
       and cardinality(coalesce(p_provider_match_keys, '{}'::text[])) = 0
       and nullif(btrim(p_work_email), '') is null
     ) then
    raise exception 'Employee identity fields are incomplete' using errcode = '22023';
  end if;

  select tenant.id, organization.id
  into strict v_tenant_id, v_organization_id
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id = tenant.id
  where tenant.slug = lower(btrim(p_tenant_slug))
    and tenant.status = 'active'
    and organization.slug = lower(btrim(p_organization_slug));

  select department.id into strict v_department_id
  from public.departments department
  where department.tenant_id = v_tenant_id
    and department.organization_id = v_organization_id
    and department.code = btrim(p_department_code)
    and department.deleted_at is null;

  select role.id into v_role_id
  from public.roles role
  where role.tenant_id = v_tenant_id
    and role.code = lower(btrim(p_role_code))
    and role.is_enabled
    and (role.organization_id is null or role.organization_id = v_organization_id)
  order by role.organization_id nulls last
  limit 1;
  if v_role_id is null then
    raise exception 'Workspace role does not exist' using errcode = '23503';
  end if;

  select provider.id into strict v_identity_provider_id
  from public.identity_providers provider
  where provider.tenant_id = v_tenant_id
    and provider.provider_code = lower(btrim(p_provider_code))
    and provider.provider_tenant_key = btrim(p_provider_tenant_key)
    and provider.status = 'active';

  select profile.id, profile.organization_member_id
  into v_profile_id, v_member_id
  from public.employee_profiles profile
  where profile.tenant_id = v_tenant_id
    and profile.organization_id = v_organization_id
    and profile.employee_no = btrim(p_employee_no)
    and profile.deleted_at is null;

  if v_profile_id is null then
    insert into public.organization_members (tenant_id, organization_id, user_id, status)
    values (v_tenant_id, v_organization_id, null, 'invited')
    returning id into v_member_id;
    insert into public.employee_profiles (
      tenant_id, organization_id, organization_member_id, employee_no,
      display_name, work_email, department_id, job_title,
      employment_status, skills
    ) values (
      v_tenant_id, v_organization_id, v_member_id, btrim(p_employee_no),
      btrim(p_display_name), nullif(lower(btrim(p_work_email)), ''),
      v_department_id, btrim(p_job_title), 'active', coalesce(p_skills, '{}'::text[])
    ) returning id into v_profile_id;
  else
    update public.employee_profiles
    set display_name = btrim(p_display_name),
        work_email = nullif(lower(btrim(p_work_email)), ''),
        department_id = v_department_id,
        job_title = btrim(p_job_title),
        skills = coalesce(p_skills, '{}'::text[])
    where tenant_id = v_tenant_id and id = v_profile_id;
  end if;

  delete from public.member_roles assignment
  using public.roles role
  where assignment.tenant_id = v_tenant_id
    and assignment.member_id = v_member_id
    and assignment.role_id = role.id
    and role.tenant_id = assignment.tenant_id
    and role.code in ('owner', 'department_head', 'employee', 'finance', 'hr');
  insert into public.member_roles (tenant_id, member_id, role_id)
  values (v_tenant_id, v_member_id, v_role_id)
  on conflict do nothing;

  insert into public.external_identities (
    tenant_id, organization_id, organization_member_id, identity_provider_id,
    provider_subject, provider_tenant_key, provider_match_keys,
    verified_email, status
  ) values (
    v_tenant_id, v_organization_id, v_member_id, v_identity_provider_id,
    nullif(btrim(p_provider_subject), ''), btrim(p_provider_tenant_key),
    coalesce(p_provider_match_keys, '{}'::text[]),
    nullif(lower(btrim(p_work_email)), ''), 'invited'
  )
  on conflict (tenant_id, identity_provider_id, organization_member_id)
  do update set
    provider_subject = excluded.provider_subject,
    provider_tenant_key = excluded.provider_tenant_key,
    provider_match_keys = excluded.provider_match_keys,
    verified_email = excluded.verified_email,
    status = case
      when public.external_identities.status in ('active', 'revoked')
        then public.external_identities.status
      else 'invited'
    end
  returning id into v_external_id;

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, (select auth.uid()), null,
    'identity.provisioned', 'external_identity', v_external_id::text,
    null, null,
    jsonb_build_object('provider', lower(btrim(p_provider_code)), 'employee_no', btrim(p_employee_no))
  );
  return v_member_id;
end;
$$;

create or replace function public.bind_preprovisioned_identity(
  p_tenant_slug text,
  p_provider_code text,
  p_provider_tenant_key text,
  p_provider_subject text,
  p_auth_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_external public.external_identities%rowtype;
  v_member_status text;
  v_employment_status text;
begin
  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'Auth user does not exist' using errcode = '23503';
  end if;
  select external.* into strict v_external
  from public.tenants tenant
  join public.identity_providers provider on provider.tenant_id = tenant.id
  join public.external_identities external
    on external.tenant_id = provider.tenant_id
   and external.identity_provider_id = provider.id
  where tenant.slug = lower(btrim(p_tenant_slug))
    and tenant.status = 'active'
    and provider.provider_code = lower(btrim(p_provider_code))
    and provider.provider_tenant_key = btrim(p_provider_tenant_key)
    and external.provider_subject = btrim(p_provider_subject)
    and external.status <> 'revoked'
  for update of external;

  if exists (
    select 1 from public.external_identities external
    where external.auth_user_id = p_auth_user_id and external.id <> v_external.id
  ) then
    raise exception 'Auth user is already bound' using errcode = '23505';
  end if;
  select member.status, profile.employment_status
  into v_member_status, v_employment_status
  from public.organization_members member
  join public.employee_profiles profile
    on profile.tenant_id = member.tenant_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
  where member.tenant_id = v_external.tenant_id
    and member.id = v_external.organization_member_id;
  if v_member_status = 'suspended' then
    raise exception 'Organization member is suspended' using errcode = '42501';
  end if;
  if v_employment_status = 'departed' then
    raise exception 'Employee has departed' using errcode = '42501';
  end if;
  update public.organization_members
  set user_id = p_auth_user_id, status = 'active'
  where tenant_id = v_external.tenant_id and id = v_external.organization_member_id;
  update public.external_identities
  set auth_user_id = p_auth_user_id, status = 'active', last_login_at = now()
  where tenant_id = v_external.tenant_id and id = v_external.id;
  perform public.append_audit_log(
    v_external.tenant_id, v_external.organization_id, (select auth.uid()),
    null, 'identity.claimed',
    'external_identity', v_external.id::text, null, null,
    jsonb_build_object('binding', 'service')
  );
end;
$$;

create or replace function public.claim_current_identity()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_provider public.identity_providers%rowtype;
  v_identity_data jsonb;
  v_auth_provider_subject text;
  v_identity_provider_subject text;
  v_identity_tenant_key text;
  v_identity_match_keys text[] := '{}'::text[];
  v_verified_email text;
  v_display_name text;
  v_avatar_url text;
  v_external public.external_identities%rowtype;
  v_bound_identity record;
  v_provider_identity record;
  v_match_count bigint;
  v_member_status text;
  v_employment_status text;
  v_bound_provider_active boolean;
  v_bound_tenant_active boolean;
begin
  if v_auth_user_id is null then
    return 'unauthenticated';
  end if;

  -- A rejected employee still needs a precise, provider-neutral reason. This
  -- lookup is scoped to the authenticated user's existing binding and exposes
  -- no tenant roster data.
  select row(external.*)::public.external_identities as external_identity,
         member.status as member_status,
         profile.employment_status as employment_status,
         provider.status = 'active' as provider_active,
         tenant.status = 'active' as tenant_active
  into v_bound_identity
  from public.external_identities external
  join public.identity_providers provider
    on provider.tenant_id = external.tenant_id
   and provider.id = external.identity_provider_id
  join public.tenants tenant
    on tenant.id = external.tenant_id
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.id = external.organization_member_id
  join public.employee_profiles profile
    on profile.tenant_id = external.tenant_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
  where external.auth_user_id = v_auth_user_id
  order by external.updated_at desc
  limit 1;

  if found then
    v_external := v_bound_identity.external_identity;
    v_member_status := v_bound_identity.member_status;
    v_employment_status := v_bound_identity.employment_status;
    v_bound_provider_active := v_bound_identity.provider_active;
    v_bound_tenant_active := v_bound_identity.tenant_active;
  end if;

  if v_external.id is not null then
    if not v_bound_provider_active or not v_bound_tenant_active then
      return 'invalid_identity';
    end if;
    if v_external.status = 'revoked' then
      return 'revoked';
    end if;
    if v_member_status = 'suspended' then
      return 'suspended';
    end if;
    if v_employment_status = 'departed' then
      return 'departed';
    end if;
  end if;

  select row(provider.*)::public.identity_providers as identity_provider,
         identity.identity_data as identity_data,
         identity.provider_id as auth_provider_subject
  into v_provider_identity
  from auth.identities identity
  join public.identity_providers provider
    on provider.auth_provider = identity.provider
   and provider.provider_tenant_key = coalesce(
     nullif(identity.identity_data ->> 'provider_tenant_key', ''),
     nullif(identity.identity_data ->> 'tenant_key', '')
   )
   and provider.status = 'active'
  join public.tenants tenant
    on tenant.id = provider.tenant_id
   and tenant.status = 'active'
  where identity.user_id = v_auth_user_id
  order by identity.updated_at desc
  limit 1;
  if not found then
    return 'not_provisioned';
  end if;
  v_provider := v_provider_identity.identity_provider;
  v_identity_data := v_provider_identity.identity_data;
  v_auth_provider_subject := v_provider_identity.auth_provider_subject;

  v_identity_provider_subject := coalesce(
    nullif(btrim(v_identity_data ->> 'provider_subject'), ''),
    nullif(btrim(v_identity_data ->> 'sub'), ''),
    nullif(btrim(v_auth_provider_subject), '')
  );
  v_identity_tenant_key := coalesce(
    nullif(btrim(v_identity_data ->> 'provider_tenant_key'), ''),
    nullif(btrim(v_identity_data ->> 'tenant_key'), '')
  );
  if jsonb_typeof(v_identity_data -> 'provider_match_keys') = 'array' then
    select coalesce(array_agg(distinct lower(btrim(match_key))), '{}'::text[])
    into v_identity_match_keys
    from jsonb_array_elements_text(v_identity_data -> 'provider_match_keys') as match_key
    where length(btrim(match_key)) between 1 and 200;
  end if;
  v_verified_email := nullif(lower(btrim(v_identity_data ->> 'verified_email')), '');
  v_display_name := nullif(btrim(coalesce(
    v_identity_data ->> 'display_name', v_identity_data ->> 'name'
  )), '');
  v_avatar_url := nullif(btrim(coalesce(
    v_identity_data ->> 'avatar_url', v_identity_data ->> 'picture'
  )), '');
  if v_identity_provider_subject is null
     and cardinality(v_identity_match_keys) = 0
     and v_verified_email is null then
    return 'invalid_identity';
  end if;

  select count(*) into v_match_count
  from public.external_identities external
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.id = external.organization_member_id
  join public.employee_profiles profile
    on profile.tenant_id = external.tenant_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
  where external.tenant_id = v_provider.tenant_id
    and external.identity_provider_id = v_provider.id
    and external.provider_tenant_key = v_identity_tenant_key
    and (
      external.provider_subject = v_identity_provider_subject
      or external.provider_match_keys && v_identity_match_keys
      or (
        v_verified_email is not null
        and external.verified_email = v_verified_email
      )
    );
  if v_match_count = 0 then
    return 'not_provisioned';
  end if;
  if v_match_count > 1 then
    return 'identity_conflict';
  end if;

  select external.* into v_external
  from public.external_identities external
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.id = external.organization_member_id
  join public.employee_profiles profile
    on profile.tenant_id = external.tenant_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
  where external.tenant_id = v_provider.tenant_id
    and external.identity_provider_id = v_provider.id
    and external.provider_tenant_key = v_identity_tenant_key
    and (
      external.provider_subject = v_identity_provider_subject
      or external.provider_match_keys && v_identity_match_keys
      or (
        v_verified_email is not null
        and external.verified_email = v_verified_email
      )
    )
  order by case
    when external.provider_subject = v_identity_provider_subject then 0
    when external.provider_match_keys && v_identity_match_keys then 1
    else 2
  end
  limit 1
  for update of external;

  if v_external.status = 'revoked' then
    return 'revoked';
  end if;
  if v_external.auth_user_id is not null
     and v_external.auth_user_id <> v_auth_user_id then
    return 'identity_conflict';
  end if;

  select member.status, profile.employment_status
  into v_member_status, v_employment_status
  from public.organization_members member
  join public.employee_profiles profile
    on profile.tenant_id = member.tenant_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
  where member.tenant_id = v_external.tenant_id
    and member.id = v_external.organization_member_id;
  if v_member_status is null or v_employment_status is null then
    return 'identity_conflict';
  end if;
  if v_member_status = 'suspended' then
    return 'suspended';
  end if;
  if v_employment_status = 'departed' then
    return 'departed';
  end if;
  if exists (
    select 1 from public.external_identities external
    where external.auth_user_id = v_auth_user_id and external.id <> v_external.id
  ) then
    return 'identity_conflict';
  end if;

  update public.organization_members
  set user_id = v_auth_user_id, status = 'active'
  where tenant_id = v_external.tenant_id
    and id = v_external.organization_member_id
    and (user_id is null or user_id = v_auth_user_id);
  if not found then
    return 'identity_conflict';
  end if;

  update public.external_identities external
  set provider_subject = coalesce(external.provider_subject, v_identity_provider_subject),
      provider_match_keys = array(
        select distinct match_key
        from unnest(external.provider_match_keys || v_identity_match_keys) as match_key
      ),
      verified_email = coalesce(external.verified_email, v_verified_email),
      auth_user_id = v_auth_user_id,
      status = 'active',
      last_login_at = now()
  where external.tenant_id = v_external.tenant_id and external.id = v_external.id;

  if v_avatar_url is not null or v_display_name is not null then
    update public.employee_profiles
    set avatar_url = coalesce(v_avatar_url, avatar_url),
        display_name = coalesce(v_display_name, display_name)
    where tenant_id = v_external.tenant_id
      and organization_member_id = v_external.organization_member_id
      and deleted_at is null;
  end if;
  perform public.append_audit_log(
    v_external.tenant_id, v_external.organization_id, v_auth_user_id,
    v_external.organization_member_id, 'identity.claimed',
    'external_identity', v_external.id::text, null, null,
    jsonb_build_object('provider', v_provider.provider_code)
  );
  return 'active';
end;
$$;

create or replace function public.current_tenant_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select external.tenant_id
  from public.external_identities external
  join public.tenants tenant
    on tenant.id = external.tenant_id
   and tenant.status = 'active'
  join public.identity_providers provider
    on provider.tenant_id = external.tenant_id
   and provider.id = external.identity_provider_id
   and provider.status = 'active'
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.id = external.organization_member_id
   and member.organization_id = external.organization_id
   and member.status = 'active'
  join public.employee_profiles profile
    on profile.tenant_id = external.tenant_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
   and profile.employment_status in ('probation', 'active', 'on_leave')
  where external.auth_user_id = (select auth.uid())
    and external.status = 'active'
  limit 1;
$$;

create or replace function public.is_organization_member(target_organization_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members member
    where member.tenant_id = (select public.current_tenant_id())
      and member.organization_id = target_organization_id
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  );
$$;

create or replace function public.has_organization_role(
  target_organization_id bigint,
  allowed_role_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    join public.member_roles assignment
      on assignment.tenant_id = member.tenant_id and assignment.member_id = member.id
    join public.roles role
      on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
    where member.tenant_id = (select public.current_tenant_id())
      and member.organization_id = target_organization_id
      and member.user_id = (select auth.uid())
      and member.status = 'active'
      and role.is_enabled
      and role.code = any (allowed_role_codes)
      and (role.organization_id is null or role.organization_id = target_organization_id)
  );
$$;

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

drop policy if exists organizations_member_select on public.organizations;
drop policy if exists organization_members_member_select on public.organization_members;
drop policy if exists roles_member_select on public.roles;
drop policy if exists member_roles_member_select on public.member_roles;
drop policy if exists role_permissions_authenticated_select on public.role_permissions;
drop policy if exists departments_member_select on public.departments;
drop policy if exists departments_hr_insert on public.departments;
drop policy if exists departments_hr_update on public.departments;
drop policy if exists employee_profiles_member_select on public.employee_profiles;
drop policy if exists employee_profiles_hr_insert on public.employee_profiles;
drop policy if exists employee_profiles_hr_update on public.employee_profiles;

alter table public.tenants enable row level security;
alter table public.tenants force row level security;
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
alter table public.departments enable row level security;
alter table public.departments force row level security;
alter table public.employee_profiles enable row level security;
alter table public.employee_profiles force row level security;
alter table public.roles enable row level security;
alter table public.roles force row level security;
alter table public.member_roles enable row level security;
alter table public.member_roles force row level security;
alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;
alter table public.identity_providers enable row level security;
alter table public.identity_providers force row level security;
alter table public.external_identities enable row level security;
alter table public.external_identities force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

create policy tenants_current_select on public.tenants
  for select to authenticated
  using (id = (select public.current_tenant_id()));

create policy organizations_tenant_member_select on public.organizations
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.is_organization_member(id))
  );

create policy organization_members_tenant_member_select on public.organization_members
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.is_organization_member(organization_id))
  );

create policy departments_tenant_member_select on public.departments
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.is_organization_member(organization_id))
  );
create policy departments_tenant_hr_insert on public.departments
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr']))
  );
create policy departments_tenant_hr_update on public.departments
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr']))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr']))
  );

create policy employee_profiles_tenant_member_select on public.employee_profiles
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.is_organization_member(organization_id))
  );
create policy employee_profiles_tenant_hr_insert on public.employee_profiles
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr']))
  );
create policy employee_profiles_tenant_hr_update on public.employee_profiles
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr']))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr']))
  );

create policy roles_tenant_member_select on public.roles
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      organization_id is null
      or (select public.is_organization_member(organization_id))
    )
  );

create policy member_roles_tenant_member_select on public.member_roles
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.organization_members member
      where member.tenant_id = member_roles.tenant_id
        and member.id = member_roles.member_id
        and (select public.is_organization_member(member.organization_id))
    )
  );

create policy role_permissions_tenant_member_select on public.role_permissions
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.organization_members member
      where member.tenant_id = role_permissions.tenant_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
    )
  );

create policy identity_providers_tenant_select on public.identity_providers
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy external_identities_tenant_self_select on public.external_identities
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and auth_user_id = (select auth.uid())
  );

create policy audit_logs_tenant_admin_select on public.audit_logs
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.organization_members member
      join public.member_roles assignment
        on assignment.tenant_id = member.tenant_id and assignment.member_id = member.id
      join public.roles role
        on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
      where member.tenant_id = audit_logs.tenant_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
        and role.is_enabled
        and role.code in ('owner', 'admin')
    )
  );

revoke all on public.identity_providers from public, anon, authenticated;
grant select on public.identity_providers to authenticated;
revoke all on public.external_identities from public, anon, authenticated;
grant select on public.external_identities to authenticated;
revoke all on public.audit_logs from public, anon, authenticated;
revoke insert, update, delete on public.audit_logs from service_role;
grant select on public.audit_logs to authenticated;
grant select on public.tenants to authenticated;

revoke execute on function public.provision_employee_identity(text,text,text,text,text,text,text,text,text,text,text[],text[],text) from public, anon, authenticated;
grant execute on function public.provision_employee_identity(text,text,text,text,text,text,text,text,text,text,text[],text[],text) to service_role;
revoke execute on function public.bind_preprovisioned_identity(text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.bind_preprovisioned_identity(text,text,text,text,uuid) to service_role;
revoke execute on function public.claim_current_identity() from public, anon;
grant execute on function public.claim_current_identity() to authenticated;
revoke execute on function public.current_tenant_id() from public, anon;
grant execute on function public.current_tenant_id() to authenticated;
revoke execute on function public.current_workspace_access() from public, anon;
grant execute on function public.current_workspace_access() to authenticated;
revoke execute on function public.append_audit_log(bigint,bigint,uuid,bigint,text,text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.append_audit_log(bigint,bigint,uuid,bigint,text,text,text,uuid,text,jsonb) to service_role;

revoke execute on function public.normalize_employee_skills() from public, anon, authenticated;
revoke execute on function public.normalize_external_identity() from public, anon, authenticated;
revoke execute on function public.guard_department_hierarchy() from public, anon, authenticated;
revoke execute on function public.guard_department_leader() from public, anon, authenticated;
revoke execute on function public.guard_employee_profile_relations() from public, anon, authenticated;
revoke execute on function public.guard_external_identity_relations() from public, anon, authenticated;
revoke execute on function public.jsonb_has_sensitive_key(jsonb) from public, anon, authenticated;
revoke execute on function public.reject_audit_log_mutation() from public, anon, authenticated;
revoke execute on function public.audit_member_status_change() from public, anon, authenticated;
revoke execute on function public.audit_member_role_change() from public, anon, authenticated;
revoke execute on function public.audit_profile_update() from public, anon, authenticated;
revoke execute on function public.audit_identity_revocation() from public, anon, authenticated;
