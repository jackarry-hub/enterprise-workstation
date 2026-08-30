begin;

-- Deterministic local/CI data only. The environment guard must authorize the
-- database target before this seed can be executed.
insert into public.tenants (public_id, name, slug, status)
values (
  '92000000-0000-4000-8000-000000000001'::uuid,
  'QuantXY Commercial Test',
  'quantxy-commercial-test',
  'active'
)
on conflict (slug) do update
set name = excluded.name,
    status = excluded.status;

insert into public.organizations (public_id, tenant_id, name, slug, timezone)
select
  '92000000-0000-4000-8000-000000000002'::uuid,
  tenant.id,
  'QuantXY Commercial Test Organization',
  'quantxy-commercial-test-org',
  'Asia/Shanghai'
from public.tenants tenant
where tenant.slug = 'quantxy-commercial-test'
on conflict (tenant_id, slug) do update
set name = excluded.name,
    timezone = excluded.timezone;

insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select
  test_tenant.id,
  null,
  source_role.code,
  source_role.name,
  source_role.description,
  true,
  true
from public.tenants test_tenant
join public.tenants source_tenant on source_tenant.slug = 'quantxy'
join public.roles source_role
  on source_role.tenant_id = source_tenant.id
 and source_role.organization_id is null
where test_tenant.slug = 'quantxy-commercial-test'
on conflict (tenant_id, code) where organization_id is null do update
set name = excluded.name,
    description = excluded.description,
    is_system = true,
    is_enabled = true;

insert into public.role_permissions (tenant_id, role_id, permission_id)
select test_role.tenant_id, test_role.id, source_assignment.permission_id
from public.tenants test_tenant
join public.tenants source_tenant on source_tenant.slug = 'quantxy'
join public.roles test_role
  on test_role.tenant_id = test_tenant.id
 and test_role.organization_id is null
join public.roles source_role
  on source_role.tenant_id = source_tenant.id
 and source_role.organization_id is null
 and source_role.code = test_role.code
join public.role_permissions source_assignment
  on source_assignment.tenant_id = source_tenant.id
 and source_assignment.role_id = source_role.id
where test_tenant.slug = 'quantxy-commercial-test'
on conflict do nothing;

insert into public.departments (
  public_id, tenant_id, organization_id, code, name, description, status, sort_order
)
select
  '92000000-0000-4000-8000-000000000003'::uuid,
  tenant.id,
  organization.id,
  'TEST',
  'Commercial Test Department',
  'Local and CI acceptance identities only',
  'active',
  10
from public.tenants tenant
join public.organizations organization on organization.tenant_id = tenant.id
where tenant.slug = 'quantxy-commercial-test'
  and organization.slug = 'quantxy-commercial-test-org'
on conflict (organization_id, code) where deleted_at is null do update
set name = excluded.name,
    description = excluded.description,
    status = excluded.status,
    sort_order = excluded.sort_order;

insert into public.identity_providers (
  tenant_id, provider_code, auth_provider, provider_tenant_key,
  display_name, status, safe_metadata
)
select
  tenant.id,
  'commercial-test',
  'custom:quantxy-commercial-test',
  'tenant_quantxy_commercial_test',
  'QuantXY Commercial Test Identity',
  'active',
  '{"environment":"local-ci"}'::jsonb
from public.tenants tenant
where tenant.slug = 'quantxy-commercial-test'
on conflict (tenant_id, provider_code) do update
set auth_provider = excluded.auth_provider,
    provider_tenant_key = excluded.provider_tenant_key,
    display_name = excluded.display_name,
    status = excluded.status,
    safe_metadata = excluded.safe_metadata;

with users(id, email, display_name) as (values
  ('92000000-0000-4000-8000-000000000101'::uuid, 'owner@quantxy-commercial.test', 'Commercial Test Owner'),
  ('92000000-0000-4000-8000-000000000102'::uuid, 'manager@quantxy-commercial.test', 'Commercial Test Manager'),
  ('92000000-0000-4000-8000-000000000103'::uuid, 'employee@quantxy-commercial.test', 'Commercial Test Employee'),
  ('92000000-0000-4000-8000-000000000104'::uuid, 'finance@quantxy-commercial.test', 'Commercial Test Finance'),
  ('92000000-0000-4000-8000-000000000105'::uuid, 'hr@quantxy-commercial.test', 'Commercial Test HR')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  users.id,
  'authenticated',
  'authenticated',
  users.email,
  crypt('quantxy-commercial-local-test-only', gen_salt('bf')),
  now(),
  jsonb_build_object('provider', 'custom:quantxy-commercial-test', 'providers', array['custom:quantxy-commercial-test']),
  jsonb_build_object('display_name', users.display_name, 'seed_scope', 'local-ci'),
  now(),
  now()
from users
on conflict (id) do nothing;

with identities(id, user_id, subject, email, display_name) as (values
  ('92000000-0000-4000-8000-000000000201'::uuid, '92000000-0000-4000-8000-000000000101'::uuid, 'commercial-test-owner', 'owner@quantxy-commercial.test', 'Commercial Test Owner'),
  ('92000000-0000-4000-8000-000000000202'::uuid, '92000000-0000-4000-8000-000000000102'::uuid, 'commercial-test-manager', 'manager@quantxy-commercial.test', 'Commercial Test Manager'),
  ('92000000-0000-4000-8000-000000000203'::uuid, '92000000-0000-4000-8000-000000000103'::uuid, 'commercial-test-employee', 'employee@quantxy-commercial.test', 'Commercial Test Employee'),
  ('92000000-0000-4000-8000-000000000204'::uuid, '92000000-0000-4000-8000-000000000104'::uuid, 'commercial-test-finance', 'finance@quantxy-commercial.test', 'Commercial Test Finance'),
  ('92000000-0000-4000-8000-000000000205'::uuid, '92000000-0000-4000-8000-000000000105'::uuid, 'commercial-test-hr', 'hr@quantxy-commercial.test', 'Commercial Test HR')
)
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  identities.id,
  identities.subject,
  identities.user_id,
  jsonb_build_object(
    'sub', identities.subject,
    'provider_subject', identities.subject,
    'provider_tenant_key', 'tenant_quantxy_commercial_test',
    'provider_match_keys', jsonb_build_array(identities.subject),
    'verified_email', identities.email,
    'display_name', identities.display_name,
    'seed_scope', 'local-ci'
  ),
  'custom:quantxy-commercial-test',
  now(),
  now(),
  now()
from identities
on conflict (id) do nothing;

with employees(employee_no, display_name, job_title, role_code, subject, email, skills) as (values
  ('TEST-OWNER', 'Commercial Test Owner', 'Owner', 'owner', 'commercial-test-owner', 'owner@quantxy-commercial.test', array['strategy']::text[]),
  ('TEST-MANAGER', 'Commercial Test Manager', 'Department Head', 'department_head', 'commercial-test-manager', 'manager@quantxy-commercial.test', array['management']::text[]),
  ('TEST-EMPLOYEE', 'Commercial Test Employee', 'Employee', 'employee', 'commercial-test-employee', 'employee@quantxy-commercial.test', array['delivery']::text[]),
  ('TEST-FINANCE', 'Commercial Test Finance', 'Finance', 'finance', 'commercial-test-finance', 'finance@quantxy-commercial.test', array['finance']::text[]),
  ('TEST-HR', 'Commercial Test HR', 'HR', 'hr', 'commercial-test-hr', 'hr@quantxy-commercial.test', array['people']::text[])
)
select public.provision_employee_identity(
  'quantxy-commercial-test',
  'quantxy-commercial-test-org',
  employees.employee_no,
  employees.display_name,
  'TEST',
  employees.job_title,
  employees.role_code,
  'commercial-test',
  'tenant_quantxy_commercial_test',
  employees.subject,
  array[employees.subject],
  employees.skills,
  employees.email
)
from employees
where not exists (
  select 1
  from public.employee_profiles profile
  join public.tenants tenant on tenant.id = profile.tenant_id
  where tenant.slug = 'quantxy-commercial-test'
    and profile.employee_no = employees.employee_no
    and profile.deleted_at is null
);

do $$
declare
  identity record;
begin
  for identity in
    select * from (values
      ('commercial-test-owner', '92000000-0000-4000-8000-000000000101'::uuid),
      ('commercial-test-manager', '92000000-0000-4000-8000-000000000102'::uuid),
      ('commercial-test-employee', '92000000-0000-4000-8000-000000000103'::uuid),
      ('commercial-test-finance', '92000000-0000-4000-8000-000000000104'::uuid),
      ('commercial-test-hr', '92000000-0000-4000-8000-000000000105'::uuid)
    ) as seed(subject, user_id)
  loop
    if not exists (
      select 1
      from public.external_identities external
      join public.identity_providers provider
        on provider.tenant_id = external.tenant_id
       and provider.id = external.identity_provider_id
      join public.tenants tenant on tenant.id = external.tenant_id
      where tenant.slug = 'quantxy-commercial-test'
        and provider.provider_code = 'commercial-test'
        and external.provider_subject = identity.subject
        and external.auth_user_id = identity.user_id
        and external.status = 'active'
    ) then
      perform public.bind_preprovisioned_identity(
        'quantxy-commercial-test',
        'commercial-test',
        'tenant_quantxy_commercial_test',
        identity.subject,
        identity.user_id
      );
    end if;
  end loop;
end;
$$;

commit;
