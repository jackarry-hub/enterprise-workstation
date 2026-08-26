begin;

select plan(11);

insert into public.tenants (name, slug, status)
values
  ('Salary privacy tenant A', 'salary-privacy-a', 'active'),
  ('Salary privacy tenant B', 'salary-privacy-b', 'active');

insert into public.organizations (tenant_id, name, slug)
select tenant.id, 'Salary privacy organization', 'salary-privacy-org'
from public.tenants tenant
where tenant.slug in ('salary-privacy-a', 'salary-privacy-b');

insert into public.identity_providers (
  tenant_id, provider_code, auth_provider, provider_tenant_key, display_name
)
select tenant.id, 'salarytest', 'custom:salarytest', tenant.slug || '-key', 'Salary test auth'
from public.tenants tenant
where tenant.slug in ('salary-privacy-a', 'salary-privacy-b');

insert into public.departments (tenant_id, organization_id, code, name)
select tenant.id, organization.id, seed.code, seed.name
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id and organization.slug = 'salary-privacy-org'
cross join (values ('ENG', 'Engineering'), ('PROD', 'Product')) as seed(code, name)
where tenant.slug = 'salary-privacy-a'
union all
select tenant.id, organization.id, 'ENG', 'Engineering'
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id and organization.slug = 'salary-privacy-org'
where tenant.slug = 'salary-privacy-b';

insert into public.position_templates (
  tenant_id, organization_id, department_id, code, name, category, status
)
select tenant.id, organization.id, department.id, seed.code, seed.name, seed.category, 'active'
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id and organization.slug = 'salary-privacy-org'
join public.departments department
  on department.tenant_id = tenant.id and department.organization_id = organization.id
cross join (values
  ('ENG20', 'Principal engineer', 'engineering', 'ENG'),
  ('PROD20', 'Principal product manager', 'product', 'PROD')
) as seed(code, name, category, department_code)
where tenant.slug = 'salary-privacy-a' and department.code = seed.department_code
union all
select tenant.id, organization.id, department.id, 'ENG20', 'Principal engineer', 'engineering', 'active'
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id and organization.slug = 'salary-privacy-org'
join public.departments department
  on department.tenant_id = tenant.id and department.organization_id = organization.id
where tenant.slug = 'salary-privacy-b' and department.code = 'ENG';

insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select tenant.id, null, seed.code, seed.name, seed.name, false, true
from public.tenants tenant
cross join (values
  ('salary_employee', 'Salary employee'),
  ('salary_manager', 'Salary manager')
) as seed(code, name)
where tenant.slug in ('salary-privacy-a', 'salary-privacy-b');

insert into public.role_permissions (tenant_id, role_id, permission_id)
select role.tenant_id, role.id, permission.id
from public.roles role
join public.permissions permission on permission.code = case
  when role.code = 'salary_employee' then 'salary.self'
  else 'salary.manage'
end
where role.code in ('salary_employee', 'salary_manager')
  and role.tenant_id in (
    select id from public.tenants where slug in ('salary-privacy-a', 'salary-privacy-b')
  );

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'salary-a-employee@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'salary-a-manager@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'salary-b-employee@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'salary-b-manager@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, seed.user_id, 'active'
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id and organization.slug = 'salary-privacy-org'
join (values
  ('salary-privacy-a', '93000000-0000-4000-8000-000000000001'::uuid),
  ('salary-privacy-a', '93000000-0000-4000-8000-000000000002'::uuid),
  ('salary-privacy-b', '93000000-0000-4000-8000-000000000003'::uuid),
  ('salary-privacy-b', '93000000-0000-4000-8000-000000000004'::uuid)
) as seed(tenant_slug, user_id) on seed.tenant_slug = tenant.slug;

insert into public.member_roles (tenant_id, member_id, role_id)
select member.tenant_id, member.id, role.id
from public.organization_members member
join public.tenants tenant on tenant.id = member.tenant_id
join public.roles role on role.tenant_id = member.tenant_id
where tenant.slug in ('salary-privacy-a', 'salary-privacy-b')
  and role.code = case
    when member.user_id in (
      '93000000-0000-4000-8000-000000000002'::uuid,
      '93000000-0000-4000-8000-000000000004'::uuid
    ) then 'salary_manager'
    else 'salary_employee'
  end;

insert into public.employee_profiles (
  tenant_id, organization_id, organization_member_id, employee_no, display_name,
  department_id, position_template_id, job_title, salary_grade_code, job_level,
  employment_status, skills
)
select member.tenant_id, member.organization_id, member.id,
  case when member.user_id::text like '%0001' then 'A-EMP'
       when member.user_id::text like '%0002' then 'A-MGR'
       when member.user_id::text like '%0003' then 'B-EMP'
       else 'B-MGR' end,
  case when member.user_id::text like '%0001' then 'A employee'
       when member.user_id::text like '%0002' then 'A manager'
       when member.user_id::text like '%0003' then 'B employee'
       else 'B manager' end,
  department.id, position.id, 'Principal', 'P6', 20, 'active', '{}'::text[]
from public.organization_members member
join public.tenants tenant on tenant.id = member.tenant_id
join public.departments department
  on department.tenant_id = member.tenant_id
 and department.organization_id = member.organization_id
 and department.code = 'ENG'
join public.position_templates position
  on position.tenant_id = member.tenant_id
 and position.organization_id = member.organization_id
 and position.code = 'ENG20'
where tenant.slug in ('salary-privacy-a', 'salary-privacy-b');

insert into public.external_identities (
  tenant_id, organization_id, organization_member_id, identity_provider_id,
  provider_subject, provider_tenant_key, auth_user_id, status
)
select member.tenant_id, member.organization_id, member.id, provider.id,
  member.user_id::text, provider.provider_tenant_key, member.user_id, 'active'
from public.organization_members member
join public.tenants tenant on tenant.id = member.tenant_id
join public.identity_providers provider
  on provider.tenant_id = member.tenant_id and provider.provider_code = 'salarytest'
where tenant.slug in ('salary-privacy-a', 'salary-privacy-b');

insert into public.salary_grade_policies (
  tenant_id, organization_id, department_id, job_family, salary_grade_code,
  job_level, base_salary, salary_band_min, salary_band_max, performance_weight,
  status, effective_from, effective_to
)
select tenant.id, organization.id,
  case when seed.department_code is null then null else department.id end,
  seed.job_family, seed.grade_code, seed.job_level, seed.base_salary,
  seed.base_salary - 5000, seed.base_salary + 5000, 0.2, 'active',
  seed.effective_from, seed.effective_to
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id and organization.slug = 'salary-privacy-org'
join (values
  ('salary-privacy-a', null::text, 'engineering', 'P6', 20, 50000::numeric, date '2000-01-01', null::date),
  ('salary-privacy-a', 'ENG', 'engineering', 'P6', 20, 60000::numeric, date '2001-01-01', null::date),
  ('salary-privacy-a', 'ENG', 'product', 'P6', 20, 90000::numeric, date '2002-01-01', null::date),
  ('salary-privacy-a', 'ENG', 'engineering', 'P6', 19, 91000::numeric, date '2002-01-01', null::date),
  ('salary-privacy-a', 'ENG', 'engineering', 'P6', 20, 92000::numeric, date '2099-01-01', null::date),
  ('salary-privacy-b', 'ENG', 'engineering', 'P6', 20, 70000::numeric, date '2001-01-01', null::date)
) as seed(tenant_slug, department_code, job_family, grade_code, job_level, base_salary, effective_from, effective_to)
  on seed.tenant_slug = tenant.slug
left join public.departments department
  on department.tenant_id = tenant.id
 and department.organization_id = organization.id
 and department.code = seed.department_code;

select has_function(
  'public', 'current_salary_grade_policy', array[]::name[],
  'self salary policy RPC accepts no employee or tenant target'
);
select ok(
  has_function_privilege('authenticated', 'public.current_salary_grade_policy()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.current_salary_grade_policy()', 'EXECUTE'),
  'only authenticated callers receive the minimal self-policy RPC grant'
);
select is(
  (select array_to_string(proconfig, ',')
   from pg_proc where oid = 'public.current_salary_grade_policy()'::regprocedure),
  'search_path=""',
  'self salary policy RPC has an empty search path'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (select count(*) from public.salary_grade_policies),
  0::bigint,
  'ordinary employee has zero direct salary policy rows'
);
select is(
  (select count(*) from public.current_salary_grade_policy()),
  1::bigint,
  'ordinary employee self RPC returns exactly one matching band'
);
select is(
  (select base_salary from public.current_salary_grade_policy()),
  60000::numeric,
  'self RPC prefers the matching department policy over organization-wide policy'
);
select is(
  (select job_family from public.current_salary_grade_policy()),
  'engineering',
  'self RPC matches the profile position category instead of the job title'
);
reset role;

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from public.salary_grade_policies),
  5::bigint,
  'salary manager reads its organization policy scope including future policy rows'
);
select is(
  (select count(*) from public.salary_grade_policies policy
   join public.tenants tenant on tenant.id = policy.tenant_id
   where tenant.slug = 'salary-privacy-b'),
  0::bigint,
  'salary manager cannot read another tenant salary policy rows'
);
reset role;

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  (select count(*) from public.salary_grade_policies),
  0::bigint,
  'second-tenant ordinary employee also has zero direct policy rows'
);
select is(
  (select base_salary from public.current_salary_grade_policy()),
  70000::numeric,
  'second-tenant self RPC derives only its own employee match'
);
reset role;

select * from finish();

rollback;
