begin;

select plan(55);

insert into public.tenants (name, slug, status)
values
  ('Employee privacy tenant A', 'employee-privacy-a', 'active'),
  ('Employee privacy tenant B', 'employee-privacy-b', 'active');

insert into public.organizations (tenant_id, name, slug)
select tenant.id, seed.name, seed.slug
from public.tenants tenant
join (values
  ('employee-privacy-a', 'Employee privacy primary', 'employee-privacy-primary'),
  ('employee-privacy-a', 'Employee privacy other', 'employee-privacy-other'),
  ('employee-privacy-b', 'Employee privacy primary', 'employee-privacy-primary')
) as seed(tenant_slug, name, slug) on seed.tenant_slug = tenant.slug;

insert into public.identity_providers (
  tenant_id, provider_code, auth_provider, provider_tenant_key, display_name
)
select tenant.id, 'employeeprivacy', 'custom:employeeprivacy', tenant.slug || '-key', 'Employee privacy test auth'
from public.tenants tenant
where tenant.slug in ('employee-privacy-a', 'employee-privacy-b');

insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select tenant.id, null, seed.code, seed.name, seed.name, true, true
from public.tenants tenant
cross join (values
  ('owner', 'Privacy owner'),
  ('admin', 'Privacy admin'),
  ('hr', 'Privacy HR'),
  ('employee', 'Privacy employee')
) as seed(code, name)
where tenant.slug in ('employee-privacy-a', 'employee-privacy-b')
on conflict do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_id)
select role.tenant_id, role.id, permission.id
from public.roles role
join public.permissions permission on permission.code in ('hr.manage', 'salary.manage')
where role.code = 'hr'
  and role.tenant_id in (
    select id from public.tenants where slug in ('employee-privacy-a', 'employee-privacy-b')
  )
on conflict do nothing;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'privacy-a-employee@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'privacy-a-hr@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'privacy-a-admin@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'privacy-a-owner@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'privacy-a-other-org@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'privacy-b-employee@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'privacy-a-suspended@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'privacy-a-departed@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, seed.user_id, seed.status
from (values
  ('employee-privacy-a', 'employee-privacy-primary', '94000000-0000-4000-8000-000000000001'::uuid, 'active'),
  ('employee-privacy-a', 'employee-privacy-primary', '94000000-0000-4000-8000-000000000002'::uuid, 'active'),
  ('employee-privacy-a', 'employee-privacy-primary', '94000000-0000-4000-8000-000000000003'::uuid, 'active'),
  ('employee-privacy-a', 'employee-privacy-primary', '94000000-0000-4000-8000-000000000004'::uuid, 'active'),
  ('employee-privacy-a', 'employee-privacy-other', '94000000-0000-4000-8000-000000000005'::uuid, 'active'),
  ('employee-privacy-b', 'employee-privacy-primary', '94000000-0000-4000-8000-000000000006'::uuid, 'active'),
  ('employee-privacy-a', 'employee-privacy-primary', '94000000-0000-4000-8000-000000000007'::uuid, 'suspended'),
  ('employee-privacy-a', 'employee-privacy-primary', '94000000-0000-4000-8000-000000000008'::uuid, 'active')
) as seed(tenant_slug, organization_slug, user_id, status)
join public.tenants tenant on tenant.slug = seed.tenant_slug
join public.organizations organization
  on organization.tenant_id = tenant.id
 and organization.slug = seed.organization_slug;

insert into public.member_roles (tenant_id, member_id, role_id)
select member.tenant_id, member.id, role.id
from public.organization_members member
join public.roles role on role.tenant_id = member.tenant_id
join (values
  ('94000000-0000-4000-8000-000000000001'::uuid, 'employee'),
  ('94000000-0000-4000-8000-000000000002'::uuid, 'hr'),
  ('94000000-0000-4000-8000-000000000003'::uuid, 'admin'),
  ('94000000-0000-4000-8000-000000000004'::uuid, 'owner'),
  ('94000000-0000-4000-8000-000000000005'::uuid, 'employee'),
  ('94000000-0000-4000-8000-000000000006'::uuid, 'employee'),
  ('94000000-0000-4000-8000-000000000007'::uuid, 'employee'),
  ('94000000-0000-4000-8000-000000000008'::uuid, 'employee')
) as seed(user_id, role_code) on seed.user_id = member.user_id and seed.role_code = role.code;

insert into public.employee_profiles (
  tenant_id, organization_id, organization_member_id, employee_no, display_name,
  work_email, phone, job_title, employment_status, hire_date, departure_date,
  salary_grade_code, job_level, skills, deleted_at
)
select member.tenant_id, member.organization_id, member.id, seed.employee_no,
  seed.display_name, seed.email, seed.phone, 'Privacy tester', seed.employment_status,
  date '2024-01-15', seed.departure_date, 'P6', 6, '{}'::text[], seed.deleted_at
from public.organization_members member
join (values
  ('94000000-0000-4000-8000-000000000001'::uuid, 'PVT-A-EMP', 'Tenant A employee', 'a.employee.private@example.test', '13800000001', 'active', null::date, null::timestamptz),
  ('94000000-0000-4000-8000-000000000002'::uuid, 'PVT-A-HR', 'Tenant A HR', 'a.hr.private@example.test', '13800000002', 'active', null::date, null::timestamptz),
  ('94000000-0000-4000-8000-000000000003'::uuid, 'PVT-A-ADMIN', 'Tenant A admin', 'a.admin.private@example.test', '13800000003', 'active', null::date, null::timestamptz),
  ('94000000-0000-4000-8000-000000000004'::uuid, 'PVT-A-OWNER', 'Tenant A owner', 'a.owner.private@example.test', '13800000004', 'active', null::date, null::timestamptz),
  ('94000000-0000-4000-8000-000000000005'::uuid, 'PVT-A-OTHER', 'Tenant A other organization', 'a.other.private@example.test', '13800000005', 'active', null::date, null::timestamptz),
  ('94000000-0000-4000-8000-000000000006'::uuid, 'PVT-B-EMP', 'Tenant B employee', 'b.employee.private@example.test', '13800000006', 'active', null::date, null::timestamptz),
  ('94000000-0000-4000-8000-000000000007'::uuid, 'PVT-A-SUSP', 'Tenant A suspended', 'a.suspended.private@example.test', '13800000007', 'active', null::date, null::timestamptz),
  ('94000000-0000-4000-8000-000000000008'::uuid, 'PVT-A-DEPARTED', 'Tenant A departed', 'a.departed.private@example.test', '13800000008', 'departed', date '2025-01-15', null::timestamptz)
) as seed(user_id, employee_no, display_name, email, phone, employment_status, departure_date, deleted_at)
  on seed.user_id = member.user_id;

-- The same auth identity is active in two organizations in tenant A. The
-- organization-bound RPCs must still expose only the caller's requested
-- active organization.
insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, '94000000-0000-4000-8000-000000000001'::uuid, 'active'
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id
 and organization.slug = 'employee-privacy-other'
where tenant.slug = 'employee-privacy-a';

insert into public.employee_profiles (
  tenant_id, organization_id, organization_member_id, employee_no, display_name,
  work_email, phone, job_title, employment_status, hire_date,
  salary_grade_code, job_level, skills
)
select
  member.tenant_id, member.organization_id, member.id, 'PVT-A-EMP-SECOND',
  'Tenant A employee second organization', 'a.employee.second.private@example.test',
  '13800000010', 'Privacy tester', 'active', date '2024-01-15', 'P6', 6, '{}'::text[]
from public.organization_members member
join public.organizations organization on organization.id = member.organization_id
where member.user_id = '94000000-0000-4000-8000-000000000001'::uuid
  and organization.slug = 'employee-privacy-other';

insert into public.employee_profiles (
  tenant_id, organization_id, employee_no, display_name, work_email, phone,
  job_title, employment_status, hire_date, salary_grade_code, job_level, skills
)
select
  tenant.id,
  organization.id,
  'PVT-A-UNBOUND',
  'Tenant A unbound manager',
  'a.unbound.private@example.test',
  '13800000009',
  'Privacy unbound manager',
  'active',
  date '2024-01-15',
  'P6',
  6,
  '{}'::text[]
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id
 and organization.slug = 'employee-privacy-primary'
where tenant.slug = 'employee-privacy-a';

update public.employee_profiles profile
set manager_employee_id = manager.id
from public.employee_profiles manager
where profile.tenant_id = manager.tenant_id
  and profile.organization_id = manager.organization_id
  and (
    (profile.employee_no = 'PVT-A-EMP' and manager.employee_no = 'PVT-A-DEPARTED')
    or (profile.employee_no = 'PVT-A-HR' and manager.employee_no = 'PVT-A-SUSP')
    or (profile.employee_no = 'PVT-A-ADMIN' and manager.employee_no = 'PVT-A-UNBOUND')
  );

update public.employee_private_profiles private
set sensitive_hr_notes = 'confidential employee note'
from public.employee_profiles profile
where private.tenant_id = profile.tenant_id
  and private.organization_id = profile.organization_id
  and private.employee_profile_id = profile.id
  and profile.employee_no = 'PVT-A-EMP';

insert into public.external_identities (
  tenant_id, organization_id, organization_member_id, identity_provider_id,
  provider_subject, provider_tenant_key, auth_user_id, status
)
select member.tenant_id, member.organization_id, member.id, provider.id,
  member.user_id::text, provider.provider_tenant_key, member.user_id, 'active'
from public.organization_members member
join public.identity_providers provider
  on provider.tenant_id = member.tenant_id and provider.provider_code = 'employeeprivacy';

update public.employee_profiles profile
set work_email = 'a.employee.private.updated@example.test'
where profile.employee_no = 'PVT-A-EMP';

select is(
  (
    select private.private_email
    from public.employee_private_profiles private
    join public.employee_profiles profile
      on profile.tenant_id = private.tenant_id
     and profile.organization_id = private.organization_id
     and profile.id = private.employee_profile_id
    where profile.employee_no = 'PVT-A-EMP'
  ),
  'a.employee.private.updated@example.test',
  'legacy employee profile writes synchronize into the private authority'
);

-- Capture foreign targets while this transaction still has its test-owner
-- fixture view. Authenticated RLS must not be allowed to turn a denied scope
-- assertion into a NULL argument and a false-positive zero-row result.
select set_config(
  'test.employee_privacy.primary_org_public_id',
  (select public_id::text from public.organizations where slug = 'employee-privacy-primary' and tenant_id = (select id from public.tenants where slug = 'employee-privacy-a')),
  true
);
select set_config(
  'test.employee_privacy.other_org_public_id',
  (select public_id::text from public.organizations where slug = 'employee-privacy-other' and tenant_id = (select id from public.tenants where slug = 'employee-privacy-a')),
  true
);
select set_config(
  'test.employee_privacy.same_user_other_org_employee_public_id',
  (select public_id::text from public.employee_profiles where employee_no = 'PVT-A-EMP-SECOND'),
  true
);
select set_config(
  'test.employee_privacy.other_org_employee_public_id',
  (select public_id::text from public.employee_profiles where employee_no = 'PVT-A-OTHER'),
  true
);
select set_config(
  'test.employee_privacy.other_org_employee_member_id',
  (select organization_member_id::text from public.employee_profiles where employee_no = 'PVT-A-OTHER'),
  true
);
select set_config(
  'test.employee_privacy.other_tenant_employee_public_id',
  (select public_id::text from public.employee_profiles where employee_no = 'PVT-B-EMP'),
  true
);
select set_config(
  'test.employee_privacy.other_tenant_employee_member_id',
  (select organization_member_id::text from public.employee_profiles where employee_no = 'PVT-B-EMP'),
  true
);
select set_config(
  'test.employee_privacy.suspended_employee_public_id',
  (select public_id::text from public.employee_profiles where employee_no = 'PVT-A-SUSP'),
  true
);
select set_config(
  'test.employee_privacy.departed_employee_public_id',
  (select public_id::text from public.employee_profiles where employee_no = 'PVT-A-DEPARTED'),
  true
);
select set_config(
  'test.employee_privacy.soft_deleted_employee_public_id',
  (select public_id::text from public.employee_profiles where employee_no = 'PVT-A-EMP'),
  true
);
select ok(
  current_setting('test.employee_privacy.other_org_employee_public_id', true) = (select public_id::text from public.employee_profiles where employee_no = 'PVT-A-OTHER')
  and current_setting('test.employee_privacy.other_org_employee_member_id', true) = (select organization_member_id::text from public.employee_profiles where employee_no = 'PVT-A-OTHER')
  and current_setting('test.employee_privacy.other_tenant_employee_public_id', true) = (select public_id::text from public.employee_profiles where employee_no = 'PVT-B-EMP')
  and current_setting('test.employee_privacy.other_tenant_employee_member_id', true) = (select organization_member_id::text from public.employee_profiles where employee_no = 'PVT-B-EMP')
  and current_setting('test.employee_privacy.suspended_employee_public_id', true) = (select public_id::text from public.employee_profiles where employee_no = 'PVT-A-SUSP')
  and current_setting('test.employee_privacy.departed_employee_public_id', true) = (select public_id::text from public.employee_profiles where employee_no = 'PVT-A-DEPARTED')
  and current_setting('test.employee_privacy.soft_deleted_employee_public_id', true) = (select public_id::text from public.employee_profiles where employee_no = 'PVT-A-EMP'),
  'scope and lifecycle denial fixtures retain real target identities'
);

select has_table('public', 'employee_private_profiles', 'private employee table exists');
select has_function('public', 'current_employee_directory', array['uuid']::name[], 'directory RPC requires the verified session organization public ID');
select has_function('public', 'current_employee_private_profile', array['uuid', 'uuid']::name[], 'private RPC requires target and verified session organization public IDs');
select ok(
  not has_function('public', 'current_employee_directory', array[]::name[]),
  'legacy directory RPC without organization scope is absent'
);
select ok(
  not has_function('public', 'current_employee_private_profile', array['uuid']::name[]),
  'legacy private RPC without organization scope is absent'
);
select has_function('public', 'current_payroll_employee_facts', array['bigint']::name[], 'payroll facts RPC accepts exactly one member target');
select ok(
  has_function_privilege('authenticated', 'public.current_employee_directory(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.current_employee_directory(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.current_employee_directory(uuid)', 'EXECUTE'),
  'only authenticated callers can execute the directory RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.current_employee_private_profile(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.current_employee_private_profile(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.current_employee_private_profile(uuid, uuid)', 'EXECUTE'),
  'only authenticated callers can execute the private RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.current_payroll_employee_facts(bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.current_payroll_employee_facts(bigint)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.current_payroll_employee_facts(bigint)', 'EXECUTE'),
  'only authenticated callers can execute the payroll facts RPC'
);
select ok(
  not has_table_privilege('anon', 'public.employee_private_profiles', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('authenticated', 'public.employee_private_profiles', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('service_role', 'public.employee_private_profiles', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'anon, authenticated, and service role have no private profile table privilege'
);
select ok(
  not has_sequence_privilege('anon', 'public.employee_private_profiles_id_seq', 'USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('authenticated', 'public.employee_private_profiles_id_seq', 'USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('service_role', 'public.employee_private_profiles_id_seq', 'USAGE,SELECT,UPDATE'),
  'anon, authenticated, and service role have no private profile identity sequence privilege'
);
select ok(
  not has_function_privilege('anon', 'public.touch_employee_private_profiles_updated_at()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.touch_employee_private_profiles_updated_at()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.touch_employee_private_profiles_updated_at()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.sync_employee_profile_private_legacy_fields()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.sync_employee_profile_private_legacy_fields()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.sync_employee_profile_private_legacy_fields()', 'EXECUTE'),
  'no API role can bypass private protections through trigger functions'
);
select is(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.current_employee_directory(uuid)'::regprocedure),
  'search_path=""',
  'directory RPC has an empty search path'
);
select is(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.current_employee_private_profile(uuid, uuid)'::regprocedure),
  'search_path=""',
  'private RPC has an empty search path'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$ select phone, work_email, hire_date, departure_date, salary_grade_code, job_level from public.employee_profiles $$,
  '42501',
  'ordinary employee cannot directly select legacy PII or salary classification columns'
);
select throws_ok(
  $$ select * from public.employee_private_profiles $$,
  '42501',
  'ordinary employee cannot directly select the private table'
);
select lives_ok(
  $$ select public_id, display_name, department_id, job_title, employment_status from public.employee_profiles $$,
  'ordinary employee retains the public legacy projection during migration'
);
select is((select count(*) from public.current_employee_directory(current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)), 5::bigint, 'directory is current-organization only and includes an active unbound profile while excluding departed, suspended, other-organization, and other-tenant rows');
select ok(
  exists (
    select 1
    from public.current_employee_directory(current_setting('test.employee_privacy.primary_org_public_id', true)::uuid) directory
    where directory.employee_no = 'PVT-A-UNBOUND'
      and directory.employment_status = 'active'
  ),
  'active unbound employee profile is visible in the directory'
);
select ok(
  not exists (
    select 1
    from public.current_employee_directory(current_setting('test.employee_privacy.primary_org_public_id', true)::uuid) directory
    where directory.employee_no = 'PVT-A-EMP'
      and (directory.manager_employee_public_id is not null or directory.manager_display_name is not null)
  ),
  'departed manager does not appear in the directory result'
);
select ok(
  not exists (
    select 1
    from public.current_employee_directory(current_setting('test.employee_privacy.primary_org_public_id', true)::uuid) directory
    where directory.employee_no = 'PVT-A-HR'
      and (directory.manager_employee_public_id is not null or directory.manager_display_name is not null)
  ),
  'suspended manager does not appear in the directory result'
);
select ok(
  exists (
    select 1
    from public.current_employee_directory(current_setting('test.employee_privacy.primary_org_public_id', true)::uuid) directory
    where directory.employee_no = 'PVT-A-ADMIN'
      and directory.manager_display_name = 'Tenant A unbound manager'
      and directory.manager_employee_public_id = (
        select public_id from public.employee_profiles where employee_no = 'PVT-A-UNBOUND'
      )
  ),
  'active unbound manager remains visible in the directory result'
);
select ok(
  not exists (
    select 1
    from public.current_employee_directory(current_setting('test.employee_privacy.primary_org_public_id', true)::uuid) directory
    where to_jsonb(directory) ?| array['phone', 'private_email', 'hire_date', 'departure_date', 'sensitive_hr_notes', 'salary_grade_code', 'job_level']
  ),
  'public directory rows contain no private PII or salary classification keys'
);
select ok(
  not exists (
    select 1
    from public.current_employee_directory(current_setting('test.employee_privacy.primary_org_public_id', true)::uuid) directory
    where directory.employee_no = 'PVT-A-EMP-SECOND'
  ),
  'same user in a second organization receives only the verified primary organization directory'
);
select is(
  (select count(*) from public.current_employee_private_profile(current_setting('test.employee_privacy.same_user_other_org_employee_public_id', true)::uuid, current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  0::bigint,
  'same user cannot fetch their own second-organization private profile through the primary organization scope'
);
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'), current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  1::bigint,
  'ordinary employee can read exactly their own private profile'
);
select is(
  (select phone from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'), current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  '13800000001',
  'self private profile returns the migrated phone'
);
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-HR'), current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  0::bigint,
  'ordinary employee cannot read another employee private profile'
);
select is(
  (select count(*) from public.current_payroll_employee_facts((select organization_member_id from public.employee_profiles where employee_no = 'PVT-A-EMP'))),
  0::bigint,
  'ordinary employee cannot read payroll employee facts'
);
select is(
  (select count(*) from public.current_employee_private_profile(current_setting('test.employee_privacy.other_org_employee_public_id', true)::uuid, current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  0::bigint,
  'ordinary employee cannot read a same-tenant other-organization private profile'
);
select is(
  (select count(*) from public.current_employee_private_profile(current_setting('test.employee_privacy.other_tenant_employee_public_id', true)::uuid, current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  0::bigint,
  'ordinary employee cannot read another-tenant private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'), current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  1::bigint,
  'same-organization HR can read an employee private profile'
);
select is(
  (select sensitive_hr_notes from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'), current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  'confidential employee note',
  'HR receives sensitive notes only through the private RPC'
);
select is(
  (select profile_id::text || ':' || organization_member_id::text || ':' || hire_date::text from public.current_payroll_employee_facts((select organization_member_id from public.employee_profiles where employee_no = 'PVT-A-EMP'))),
  (select id::text || ':' || organization_member_id::text || ':2024-01-15' from public.employee_profiles where employee_no = 'PVT-A-EMP'),
  'salary manager receives only the target payroll calculation facts through the scoped RPC'
);
select is(
  (select hire_date from public.current_payroll_employee_facts((select organization_member_id from public.employee_profiles where employee_no = 'PVT-A-SUSP'))),
  date '2024-01-15',
  'salary manager can calculate a final payroll for a suspended target member'
);
select is(
  (select hire_date from public.current_payroll_employee_facts((select organization_member_id from public.employee_profiles where employee_no = 'PVT-A-DEPARTED'))),
  date '2024-01-15',
  'salary manager can calculate a final payroll for a departed target employee'
);
select is(
  (select count(*) from public.current_employee_private_profile(current_setting('test.employee_privacy.other_org_employee_public_id', true)::uuid, current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  0::bigint,
  'HR cannot read a same-tenant other-organization private profile'
);
select is(
  (select count(*) from public.current_payroll_employee_facts(current_setting('test.employee_privacy.other_org_employee_member_id', true)::bigint)),
  0::bigint,
  'salary manager cannot read same-tenant other-organization payroll facts'
);
select is(
  (select count(*) from public.current_employee_private_profile(current_setting('test.employee_privacy.other_tenant_employee_public_id', true)::uuid, current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  0::bigint,
  'HR cannot read another-tenant private profile'
);
select is(
  (select count(*) from public.current_payroll_employee_facts(current_setting('test.employee_privacy.other_tenant_employee_member_id', true)::bigint)),
  0::bigint,
  'salary manager cannot read another-tenant payroll facts'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'), current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  1::bigint,
  'same-organization admin can read the private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'), current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  1::bigint,
  'same-organization owner can read the private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select is((select count(*) from public.current_employee_directory(current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)), 0::bigint, 'suspended member cannot access the directory RPC');
select is(
  (select count(*) from public.current_employee_private_profile(current_setting('test.employee_privacy.suspended_employee_public_id', true)::uuid, current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  0::bigint,
  'suspended member cannot access their private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000008', true);
set local role authenticated;
select is((select count(*) from public.current_employee_directory(current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)), 0::bigint, 'departed member cannot access the directory RPC');
select is(
  (select count(*) from public.current_employee_private_profile(current_setting('test.employee_privacy.departed_employee_public_id', true)::uuid, current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  0::bigint,
  'departed member cannot access their private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$ update public.employee_profiles set work_email = 'blocked-private-write@example.test' where employee_no = 'PVT-A-EMP' $$,
  '42501',
  'HR cannot update a legacy private employee field directly'
);
select ok(
  not has_column_privilege('authenticated', 'public.employee_profiles', 'organization_member_id', 'INSERT,UPDATE')
  and not has_column_privilege('authenticated', 'public.employee_profiles', 'employee_no', 'INSERT,UPDATE')
  and not has_column_privilege('authenticated', 'public.employee_profiles', 'employment_status', 'INSERT,UPDATE')
  and not has_column_privilege('authenticated', 'public.employee_profiles', 'position_template_id', 'INSERT,UPDATE'),
  'authenticated cannot insert or update provider-owned identity and lifecycle profile columns'
);
select throws_ok(
  $$ update public.employee_profiles set organization_member_id = null where employee_no = 'PVT-A-EMP' $$,
  '42501',
  'HR cannot directly rebind an employee profile membership'
);
select throws_ok(
  $$ update public.employee_profiles set employee_no = 'PVT-A-HIJACKED' where employee_no = 'PVT-A-EMP' $$,
  '42501',
  'HR cannot directly change an employee number'
);
select throws_ok(
  $$ update public.employee_profiles set employment_status = 'departed' where employee_no = 'PVT-A-EMP' $$,
  '42501',
  'HR cannot directly change employment lifecycle status'
);
select throws_ok(
  $$ update public.employee_profiles set job_title = 'Privacy-safe HR update' where employee_no = 'PVT-A-EMP' $$,
  '42501',
  'HR cannot bypass controlled employee mutation through a public display field'
);
reset role;
update public.employee_profiles
set deleted_at = clock_timestamp()
where employee_no = 'PVT-A-EMP';
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from public.current_employee_private_profile(current_setting('test.employee_privacy.soft_deleted_employee_public_id', true)::uuid, current_setting('test.employee_privacy.primary_org_public_id', true)::uuid)),
  0::bigint,
  'soft-deleted employee private profile is unavailable even to HR'
);
reset role;

select * from finish();
rollback;
