begin;

select plan(29);

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
join public.permissions permission on permission.code = 'hr.manage'
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

select has_table('public', 'employee_private_profiles', 'private employee table exists');
select has_function('public', 'current_employee_directory', array[]::name[], 'directory RPC has no caller-controlled scope');
select has_function('public', 'current_employee_private_profile', array['uuid']::name[], 'private RPC accepts exactly one public employee target');
select ok(
  has_function_privilege('authenticated', 'public.current_employee_directory()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.current_employee_directory()', 'EXECUTE'),
  'only authenticated callers can execute the directory RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.current_employee_private_profile(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.current_employee_private_profile(uuid)', 'EXECUTE'),
  'only authenticated callers can execute the private RPC'
);
select is(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.current_employee_directory()'::regprocedure),
  'search_path=""',
  'directory RPC has an empty search path'
);
select is(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.current_employee_private_profile(uuid)'::regprocedure),
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
select is((select count(*) from public.current_employee_directory()), 4::bigint, 'directory is current-organization only and excludes departed, suspended, other-organization, and other-tenant rows');
select ok(
  not exists (
    select 1
    from public.current_employee_directory() directory
    where to_jsonb(directory) ?| array['phone', 'private_email', 'hire_date', 'departure_date', 'sensitive_hr_notes', 'salary_grade_code', 'job_level']
  ),
  'public directory rows contain no private PII or salary classification keys'
);
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'))),
  1::bigint,
  'ordinary employee can read exactly their own private profile'
);
select is(
  (select phone from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'))),
  '13800000001',
  'self private profile returns the migrated phone'
);
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-HR'))),
  0::bigint,
  'ordinary employee cannot read another employee private profile'
);
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-OTHER'))),
  0::bigint,
  'ordinary employee cannot read a same-tenant other-organization private profile'
);
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-B-EMP'))),
  0::bigint,
  'ordinary employee cannot read another-tenant private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'))),
  1::bigint,
  'same-organization HR can read an employee private profile'
);
select is(
  (select sensitive_hr_notes from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'))),
  'confidential employee note',
  'HR receives sensitive notes only through the private RPC'
);
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-OTHER'))),
  0::bigint,
  'HR cannot read a same-tenant other-organization private profile'
);
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-B-EMP'))),
  0::bigint,
  'HR cannot read another-tenant private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'))),
  1::bigint,
  'same-organization admin can read the private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'))),
  1::bigint,
  'same-organization owner can read the private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select is((select count(*) from public.current_employee_directory()), 0::bigint, 'suspended member cannot access the directory RPC');
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-SUSP'))),
  0::bigint,
  'suspended member cannot access their private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000008', true);
set local role authenticated;
select is((select count(*) from public.current_employee_directory()), 0::bigint, 'departed member cannot access the directory RPC');
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-DEPARTED'))),
  0::bigint,
  'departed member cannot access their private profile'
);
reset role;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
set local role authenticated;
update public.employee_profiles
set deleted_at = clock_timestamp()
where employee_no = 'PVT-A-EMP';
select is(
  (select count(*) from public.current_employee_private_profile((select public_id from public.employee_profiles where employee_no = 'PVT-A-EMP'))),
  0::bigint,
  'soft-deleted employee private profile is unavailable even to HR'
);
reset role;

select * from finish();
rollback;
