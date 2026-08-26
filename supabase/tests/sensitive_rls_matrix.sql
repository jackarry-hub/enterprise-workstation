begin;

select plan(106);

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

select set_config(
  'test.salary_privacy_b_tenant_id',
  (select id::text from public.tenants where slug = 'salary-privacy-b'),
  true
);
select set_config(
  'test.salary_privacy_b_organization_id',
  (
    select organization.id::text
    from public.organizations organization
    join public.tenants tenant on tenant.id = organization.tenant_id
    where tenant.slug = 'salary-privacy-b'
      and organization.slug = 'salary-privacy-org'
  ),
  true
);
select set_config(
  'test.salary_privacy_b_department_id',
  (
    select department.id::text
    from public.departments department
    join public.tenants tenant on tenant.id = department.tenant_id
    where tenant.slug = 'salary-privacy-b' and department.code = 'ENG'
  ),
  true
);

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
select is(
  timezone('Asia/Shanghai', '2026-08-25T16:00:00Z'::timestamptz)::date,
  date '2026-08-26',
  'self RPC uses the same Asia/Shanghai day as the manager bootstrap after UTC 16:00'
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
select throws_ok(
  $$
    insert into public.salary_grade_policies (
      tenant_id, organization_id, job_family, salary_grade_code, job_level,
      base_salary, salary_band_min, salary_band_max, performance_weight,
      status, effective_from
    )
    select tenant.id, organization.id, 'engineering', 'P8', 20,
      80000, 75000, 85000, 0.2, 'active', date '2000-01-01'
    from public.tenants tenant
    join public.organizations organization
      on organization.tenant_id = tenant.id
    where tenant.slug = 'salary-privacy-a'
      and organization.slug = 'salary-privacy-org'
  $$,
  '42501',
  'new row violates row-level security policy for table "salary_grade_policies"',
  'role code without salary.manage cannot insert a salary policy'
);
select is(
  (
    with attempted as (
      update public.salary_grade_policies
      set base_salary = 61000
      where base_salary = 60000
      returning id
    )
    select count(*) from attempted
  ),
  0::bigint,
  'role code without salary.manage cannot update a salary policy'
);
reset role;
select is(
  (
    select base_salary
    from public.salary_grade_policies policy
    join public.tenants tenant on tenant.id = policy.tenant_id
    where tenant.slug = 'salary-privacy-a' and policy.base_salary = 60000
  ),
  60000::numeric,
  'denied employee writes leave the department policy unchanged'
);

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
select is(
  (
    with updated as (
      update public.salary_grade_policies
      set base_salary = 61000
      where base_salary = 60000
      returning base_salary
    )
    select base_salary from updated
  ),
  61000::numeric,
  'enabled salary manager can update a policy in its own tenant and organization'
);
select is(
  (
    with inserted as (
      insert into public.salary_grade_policies (
        tenant_id, organization_id, job_family, salary_grade_code, job_level,
        base_salary, salary_band_min, salary_band_max, performance_weight,
        status, effective_from
      )
      select tenant.id, organization.id, 'engineering', 'P7', 20,
        70000, 65000, 75000, 0.2, 'active', date '2000-01-01'
      from public.tenants tenant
      join public.organizations organization
        on organization.tenant_id = tenant.id
      where tenant.slug = 'salary-privacy-a'
        and organization.slug = 'salary-privacy-org'
      returning id
    )
    select count(*) from inserted
  ),
  1::bigint,
  'enabled salary manager can insert a policy only for its own tenant and organization'
);
select throws_ok(
  $$
    insert into public.salary_grade_policies (
      tenant_id, organization_id, department_id, job_family, salary_grade_code,
      job_level, base_salary, salary_band_min, salary_band_max, performance_weight,
      status, effective_from
    ) values (
      current_setting('test.salary_privacy_b_tenant_id')::bigint,
      current_setting('test.salary_privacy_b_organization_id')::bigint,
      current_setting('test.salary_privacy_b_department_id')::bigint,
      'engineering', 'P8', 20, 80000, 75000, 85000, 0.2, 'active', date '2000-01-01'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "salary_grade_policies"',
  'salary manager cannot insert a policy into another tenant'
);
reset role;

update public.roles role
set is_enabled = false
from public.tenants tenant
where tenant.id = role.tenant_id
  and tenant.slug = 'salary-privacy-a'
  and role.code = 'salary_manager';
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from public.salary_grade_policies),
  0::bigint,
  'disabled salary.manage role loses direct salary policy access through the helper'
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

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'approval-a-approver@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'approval-a-unrelated@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, seed.user_id, 'active'
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id and organization.slug = 'salary-privacy-org'
join (values
  ('93000000-0000-4000-8000-000000000005'::uuid),
  ('93000000-0000-4000-8000-000000000006'::uuid)
) as seed(user_id) on true
where tenant.slug = 'salary-privacy-a';

insert into public.member_roles (tenant_id, member_id, role_id)
select member.tenant_id, member.id, role.id
from public.organization_members member
join public.roles role on role.tenant_id = member.tenant_id and role.code = 'salary_manager'
where member.user_id = '93000000-0000-4000-8000-000000000006'::uuid;

insert into public.employee_profiles (
  tenant_id, organization_id, organization_member_id, employee_no, display_name,
  department_id, position_template_id, job_title, salary_grade_code, job_level,
  employment_status, skills
)
select member.tenant_id, member.organization_id, member.id,
  case when member.user_id = '93000000-0000-4000-8000-000000000005'::uuid then 'A-APR' else 'A-OTHER' end,
  case when member.user_id = '93000000-0000-4000-8000-000000000005'::uuid then 'A approver' else 'A unrelated' end,
  department.id, position.id, 'Principal', 'P6', 20, 'active', '{}'::text[]
from public.organization_members member
join public.departments department
  on department.tenant_id = member.tenant_id
 and department.organization_id = member.organization_id
 and department.code = 'ENG'
join public.position_templates position
  on position.tenant_id = member.tenant_id
 and position.organization_id = member.organization_id
 and position.code = 'ENG20'
where member.user_id in (
  '93000000-0000-4000-8000-000000000005'::uuid,
  '93000000-0000-4000-8000-000000000006'::uuid
);

insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, '93000000-0000-4000-8000-000000000001'::uuid, 'active'
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id and organization.slug = 'salary-privacy-org'
where tenant.slug = 'salary-privacy-b';

insert into public.employee_profiles (
  tenant_id, organization_id, organization_member_id, employee_no, display_name,
  department_id, position_template_id, job_title, salary_grade_code, job_level,
  employment_status, skills
)
select member.tenant_id, member.organization_id, member.id,
  'B-SAME-UID', 'B same JWT participant', department.id, position.id,
  'Principal', 'P6', 20, 'active', '{}'::text[]
from public.organization_members member
join public.departments department
  on department.tenant_id = member.tenant_id
 and department.organization_id = member.organization_id
 and department.code = 'ENG'
join public.position_templates position
  on position.tenant_id = member.tenant_id
 and position.organization_id = member.organization_id
 and position.code = 'ENG20'
where member.user_id = '93000000-0000-4000-8000-000000000001'::uuid
  and member.tenant_id = (select id from public.tenants where slug = 'salary-privacy-b');

insert into public.approvals (
  organization_id, applicant_employee_id, owner_employee_id, approval_code,
  approval_type, title, status, submitted_at
)
select organization.id,
  (select profile.id from public.employee_profiles profile join public.organization_members member on member.id = profile.organization_member_id where member.user_id = '93000000-0000-4000-8000-000000000001'::uuid),
  (select profile.id from public.employee_profiles profile join public.organization_members member on member.id = profile.organization_member_id where member.user_id = '93000000-0000-4000-8000-000000000002'::uuid),
  'APR-PRIVACY-001', 'reimbursement', 'Participant-only approval', 'pending', now()
from public.organizations organization
join public.tenants tenant on tenant.id = organization.tenant_id
where tenant.slug = 'salary-privacy-a' and organization.slug = 'salary-privacy-org';

insert into public.approval_steps (organization_id, approval_id, step_order, name, approver_employee_id)
select approval.organization_id, approval.id, 1, 'Assigned approver',
  (select profile.id from public.employee_profiles profile join public.organization_members member on member.id = profile.organization_member_id where member.user_id = '93000000-0000-4000-8000-000000000005'::uuid)
from public.approvals approval
where approval.approval_code = 'APR-PRIVACY-001';

insert into public.approvals (
  organization_id, applicant_employee_id, owner_employee_id, approval_code,
  approval_type, title, status, submitted_at
)
select organization.id,
  (select profile.id from public.employee_profiles profile join public.organization_members member on member.id = profile.organization_member_id where member.user_id = '93000000-0000-4000-8000-000000000001'::uuid and member.tenant_id = tenant.id),
  (select profile.id from public.employee_profiles profile join public.organization_members member on member.id = profile.organization_member_id where member.user_id = '93000000-0000-4000-8000-000000000003'::uuid and member.tenant_id = tenant.id),
  'APR-PRIVACY-CROSS-TENANT', 'reimbursement', 'Same JWT cross-tenant approval', 'pending', now()
from public.organizations organization
join public.tenants tenant on tenant.id = organization.tenant_id
where tenant.slug = 'salary-privacy-b' and organization.slug = 'salary-privacy-org';

insert into public.approval_steps (organization_id, approval_id, step_order, name, approver_employee_id)
select approval.organization_id, approval.id, 1, 'Same JWT assigned approver', approval.applicant_employee_id
from public.approvals approval
where approval.approval_code = 'APR-PRIVACY-CROSS-TENANT';

insert into public.approval_actions (organization_id, approval_id, actor_employee_id, action_type, content)
select approval.organization_id, approval.id, approval.applicant_employee_id, 'comment', 'same JWT in another tenant'
from public.approvals approval
where approval.approval_code = 'APR-PRIVACY-CROSS-TENANT';

insert into public.approval_actions (organization_id, approval_id, actor_employee_id, action_type, content)
select approval.organization_id, approval.id,
  (select profile.id from public.employee_profiles profile join public.organization_members member on member.id = profile.organization_member_id where member.user_id = '93000000-0000-4000-8000-000000000006'::uuid),
  'comment', 'ordinary actor must not become a participant'
from public.approvals approval
where approval.approval_code = 'APR-PRIVACY-001';

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*) from public.approvals where approval_code = 'APR-PRIVACY-001'), 1::bigint, 'applicant reads the approval');
select is((select count(*) from public.approval_steps where approval_id = (select id from public.approvals where approval_code = 'APR-PRIVACY-001')), 1::bigint, 'applicant reads the approval steps');
select is((select count(*) from public.approval_actions where approval_id = (select id from public.approvals where approval_code = 'APR-PRIVACY-001')), 1::bigint, 'applicant reads the approval actions');
select is((select public.current_tenant_id()), (select id from public.tenants where slug = 'salary-privacy-a'), 'same JWT resolves the active identity to tenant A');
select is((select count(*) from public.approvals where approval_code = 'APR-PRIVACY-CROSS-TENANT'), 0::bigint, 'same JWT cannot read a participant approval outside its current tenant');
select is((select count(*) from public.approval_steps where approval_id = (select id from public.approvals where approval_code = 'APR-PRIVACY-CROSS-TENANT')), 0::bigint, 'same JWT cannot read cross-tenant participant steps');
select is((select count(*) from public.approval_actions where approval_id = (select id from public.approvals where approval_code = 'APR-PRIVACY-CROSS-TENANT')), 0::bigint, 'same JWT cannot read cross-tenant participant actions');
reset role;

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*) from public.approvals where approval_code = 'APR-PRIVACY-001'), 1::bigint, 'owner reads the approval');
select is((select count(*) from public.approval_steps where approval_id = (select id from public.approvals where approval_code = 'APR-PRIVACY-001')), 1::bigint, 'owner reads the approval steps');
select is((select count(*) from public.approval_actions where approval_id = (select id from public.approvals where approval_code = 'APR-PRIVACY-001')), 1::bigint, 'owner reads the approval actions');
reset role;

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select is((select count(*) from public.approvals where approval_code = 'APR-PRIVACY-001'), 1::bigint, 'assigned approver reads the approval');
select is((select count(*) from public.approval_steps where approval_id = (select id from public.approvals where approval_code = 'APR-PRIVACY-001')), 1::bigint, 'assigned approver reads the approval steps');
select is((select count(*) from public.approval_actions where approval_id = (select id from public.approvals where approval_code = 'APR-PRIVACY-001')), 1::bigint, 'assigned approver reads the approval actions');
reset role;

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000006', true);
set local role authenticated;
select is((select count(*) from public.approvals where approval_code = 'APR-PRIVACY-001'), 0::bigint, 'unrelated employee with a manager role reads zero approvals');
select is((select count(*) from public.approval_steps), 0::bigint, 'unrelated active employee reads zero approval steps');
select is((select count(*) from public.approval_actions), 0::bigint, 'unrelated action actor reads zero approval actions');
reset role;

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is((select count(*) from public.approvals), 0::bigint, 'other-tenant employee reads zero approvals');
select is((select count(*) from public.approval_steps), 0::bigint, 'other-tenant employee reads zero approval steps');
select is((select count(*) from public.approval_actions), 0::bigint, 'other-tenant employee reads zero approval actions');
reset role;

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok($$ insert into public.approvals (organization_id, applicant_employee_id, approval_code, approval_type, title) select organization_id, applicant_employee_id, 'APR-PRIVACY-DENIED', 'leave', 'denied' from public.approvals where approval_code = 'APR-PRIVACY-001' $$, '42501', 'authenticated callers cannot directly insert approvals');
select throws_ok($$ update public.approvals set title = 'mutated' where approval_code = 'APR-PRIVACY-001' $$, '42501', 'authenticated callers cannot directly update approvals');
select throws_ok($$ delete from public.approvals where approval_code = 'APR-PRIVACY-001' $$, '42501', 'authenticated callers cannot directly delete approvals');
select throws_ok($$ insert into public.approval_steps (organization_id, approval_id, step_order, name) select organization_id, id, 2, 'denied' from public.approvals where approval_code = 'APR-PRIVACY-001' $$, '42501', 'authenticated callers cannot directly insert approval steps');
select throws_ok($$ update public.approval_steps set name = 'mutated' $$, '42501', 'authenticated callers cannot directly update approval steps');
select throws_ok($$ delete from public.approval_steps $$, '42501', 'authenticated callers cannot directly delete approval steps');
select throws_ok($$ insert into public.approval_actions (organization_id, approval_id, actor_employee_id, action_type) select approval.organization_id, approval.id, approval.applicant_employee_id, 'comment' from public.approvals approval where approval.approval_code = 'APR-PRIVACY-001' $$, '42501', 'authenticated callers cannot directly insert approval actions');
select throws_ok($$ update public.approval_actions set content = 'mutated' $$, '42501', 'authenticated callers cannot directly update approval actions');
select throws_ok($$ delete from public.approval_actions $$, '42501', 'authenticated callers cannot directly delete approval actions');
reset role;

select is((select title from public.approvals where approval_code = 'APR-PRIVACY-001'), 'Participant-only approval', 'denied approval writes leave the approval unchanged');
select is((select name from public.approval_steps where approval_id = (select id from public.approvals where approval_code = 'APR-PRIVACY-001')), 'Assigned approver', 'denied step writes leave the step unchanged');
select is((select content from public.approval_actions where approval_id = (select id from public.approvals where approval_code = 'APR-PRIVACY-001')), 'ordinary actor must not become a participant', 'denied action writes leave the action unchanged');

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(pg_get_serial_sequence('public.approvals', 'id'), 'public.approvals_id_seq', 'approvals uses its expected identity sequence');
select is(pg_get_serial_sequence('public.approval_steps', 'id'), 'public.approval_steps_id_seq', 'approval steps uses its expected identity sequence');
select is(pg_get_serial_sequence('public.approval_actions', 'id'), 'public.approval_actions_id_seq', 'approval actions uses its expected identity sequence');
select throws_ok($$ select nextval('public.approvals_id_seq') $$, '42501', 'authenticated callers cannot consume the approvals identity sequence');
select throws_ok($$ select nextval('public.approval_steps_id_seq') $$, '42501', 'authenticated callers cannot consume the approval steps identity sequence');
select throws_ok($$ select nextval('public.approval_actions_id_seq') $$, '42501', 'authenticated callers cannot consume the approval actions identity sequence');
reset role;

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok($$ insert into public.agent_invocations default values $$, '42501', 'authenticated callers cannot directly insert Agent invocations');
select throws_ok($$ update public.agent_invocations set status = 'succeeded' $$, '42501', 'authenticated callers cannot directly update Agent invocations');
select throws_ok($$ delete from public.agent_invocations $$, '42501', 'authenticated callers cannot directly delete Agent invocations');
select throws_ok($$ insert into public.agent_execution_logs default values $$, '42501', 'authenticated callers cannot directly insert Agent execution logs');
select throws_ok($$ update public.agent_execution_logs set message = 'mutated' $$, '42501', 'authenticated callers cannot directly update Agent execution logs');
select throws_ok($$ delete from public.agent_execution_logs $$, '42501', 'authenticated callers cannot directly delete Agent execution logs');
select throws_ok($$ select nextval('public.agent_invocations_id_seq') $$, '42501', 'authenticated callers cannot consume the Agent invocation identity sequence');
select throws_ok($$ select nextval('public.agent_execution_logs_id_seq') $$, '42501', 'authenticated callers cannot consume the Agent execution log identity sequence');
reset role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'agent-ledger-fixture@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, '93000000-0000-4000-8000-000000000007'::uuid, 'active'
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id and organization.slug = 'salary-privacy-org'
where tenant.slug = 'salary-privacy-a';

insert into public.agent_definitions (
  tenant_id, organization_id, code, name, description, model_code, prompt_version,
  system_prompt, tool_scope, visibility_scope, min_job_level, status
)
select tenant.id, organization.id, 'security-pgtap-execution-fixture', 'Security pgTAP execution fixture',
  'An explicit ledger test fixture', 'deepseek-chat', 'v1', 'Use only server-owned policy.',
  '{"tools":["task.read"]}'::jsonb, 'all', 1, 'enabled'
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id and organization.slug = 'salary-privacy-org'
where tenant.slug = 'salary-privacy-a';

insert into public.agent_permissions (
  tenant_id, organization_id, agent_id, scope_type, member_id, min_job_level
)
select agent.tenant_id, agent.organization_id, agent.id, 'member', member.id, 1
from public.agent_definitions agent
join public.organization_members member
  on member.tenant_id = agent.tenant_id and member.organization_id = agent.organization_id
 and member.user_id = '93000000-0000-4000-8000-000000000007'::uuid and member.status = 'active'
where agent.code = 'security-pgtap-execution-fixture';

select ok(public.is_agent_execution_ready('deepseek-chat', 'v1', 'Use only server-owned policy.', '{"tools":["task.read"]}'::jsonb), 'execution-ready validator accepts the explicit fixture configuration');
select ok(not public.is_agent_execution_ready('browser-model', 'v1', 'Use only server-owned policy.', '{"tools":["task.read"]}'::jsonb), 'execution-ready validator rejects models outside the shared allowlist');
select ok(not public.is_agent_execution_ready('deepseek-chat', ' v1', 'Use only server-owned policy.', '{"tools":["task.read"]}'::jsonb), 'execution-ready validator rejects whitespace prompt versions');
select ok(not public.is_agent_execution_ready('deepseek-chat', 'v1', repeat('x', 12001), '{"tools":["task.read"]}'::jsonb), 'execution-ready validator rejects overlong prompts');
select ok(not public.is_agent_execution_ready('deepseek-chat', 'v1', 'Use only server-owned policy.', '{"tools":[" task.read"]}'::jsonb), 'execution-ready validator rejects whitespace tool codes');
select ok(not public.is_agent_execution_ready('deepseek-chat', 'v1', 'Use only server-owned policy.', '{"tools":1}'::jsonb), 'execution-ready validator returns false for scalar tools without throwing');
select ok(not public.is_agent_execution_ready('deepseek-chat', 'v1', 'Use only server-owned policy.', '42'::jsonb), 'execution-ready validator returns false for scalar tool scopes without throwing');
select ok(not public.is_agent_execution_ready('deepseek-chat', 'v1', 'Use only server-owned policy.', '[]'::jsonb), 'execution-ready validator returns false for array tool scopes without throwing');
select ok(not public.is_agent_execution_ready('deepseek-chat', E'\tv1', 'Use only server-owned policy.', '{"tools":["task.read"]}'::jsonb), 'execution-ready validator rejects a leading tab exactly as the TypeScript contract does');
select ok(not public.is_agent_execution_ready('deepseek-chat', 'v1', 'Use only server-owned policy.', ('{"tools":["task.read' || chr(160) || '"]}')::jsonb), 'execution-ready validator rejects a trailing NBSP tool exactly as the TypeScript contract does');
select ok(public.is_agent_execution_ready('deepseek-chat', repeat('😀', 10), 'Use only server-owned policy.', '{"tools":["task.read"]}'::jsonb), 'execution-ready validator accepts a 40-byte emoji prompt version');
select ok(not public.is_agent_execution_ready('deepseek-chat', repeat('😀', 11), 'Use only server-owned policy.', '{"tools":["task.read"]}'::jsonb), 'execution-ready validator rejects a 44-byte emoji prompt version');

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok($$ select system_prompt from public.agent_definitions where code = 'security-pgtap-execution-fixture' $$, '42501', 'authenticated callers cannot read the fixture Agent system prompt');
select lives_ok($$ select id, public_id, model_code, tool_scope from public.agent_definitions $$, 'authenticated callers can read safe Agent definition columns');
select throws_ok($$ insert into public.agent_definitions default values $$, '42501', 'authenticated callers cannot directly insert Agent definitions');
select throws_ok($$ update public.agent_definitions set name = 'mutated' $$, '42501', 'authenticated callers cannot directly update Agent definitions');
select throws_ok($$ delete from public.agent_definitions $$, '42501', 'authenticated callers cannot directly delete Agent definitions');
select throws_ok($$ insert into public.agent_permissions default values $$, '42501', 'authenticated callers cannot directly insert Agent permissions');
select throws_ok($$ update public.agent_permissions set min_job_level = 1 $$, '42501', 'authenticated callers cannot directly update Agent permissions');
select throws_ok($$ delete from public.agent_permissions $$, '42501', 'authenticated callers cannot directly delete Agent permissions');
reset role;

select ok(has_table_privilege('service_role', 'public.agent_invocations', 'SELECT,INSERT'), 'service role can read and append Agent invocations');
select ok(not has_table_privilege('service_role', 'public.agent_invocations', 'UPDATE,DELETE,TRUNCATE'), 'service role cannot mutate or truncate Agent invocations');
select ok(has_table_privilege('service_role', 'public.agent_execution_logs', 'SELECT,INSERT'), 'service role can read and append Agent execution logs');
select ok(not has_table_privilege('service_role', 'public.agent_execution_logs', 'UPDATE,DELETE,TRUNCATE'), 'service role cannot mutate or truncate Agent execution logs');

set local role service_role;
select lives_ok($$ insert into public.agent_invocations (tenant_id, organization_id, agent_id, actor_member_id, status, input_summary, started_at, completed_at) values ((select tenant_id from public.agent_definitions where code = 'security-pgtap-execution-fixture'), (select organization_id from public.agent_definitions where code = 'security-pgtap-execution-fixture'), (select id from public.agent_definitions where code = 'security-pgtap-execution-fixture'), (select id from public.organization_members where user_id = '93000000-0000-4000-8000-000000000007'::uuid), 'succeeded', 'security-fixture-invocation', clock_timestamp(), clock_timestamp()) returning id $$, 'service role appends the explicit Agent invocation fixture');
select is((select count(*) from public.agent_invocations where input_summary = 'security-fixture-invocation'), 1::bigint, 'service invocation INSERT RETURNING fixture added exactly one row');
select throws_ok($$ insert into public.agent_invocations (tenant_id, organization_id, agent_id, actor_member_id, status, started_at) values ((select tenant_id from public.agent_definitions where code = 'security-pgtap-execution-fixture'), (select organization_id from public.agent_definitions where code = 'security-pgtap-execution-fixture'), (select id from public.agent_definitions where code = 'security-pgtap-execution-fixture'), (select id from public.organization_members where user_id = '93000000-0000-4000-8000-000000000007'::uuid), 'succeeded', clock_timestamp()) $$, '23514', 'terminal Agent invocation requires completed_at');
select throws_ok($$ insert into public.agent_invocations (tenant_id, organization_id, agent_id, actor_member_id, status, started_at, completed_at) values ((select tenant_id from public.agent_definitions where code = 'security-pgtap-execution-fixture'), (select organization_id from public.agent_definitions where code = 'security-pgtap-execution-fixture'), (select id from public.agent_definitions where code = 'security-pgtap-execution-fixture'), (select id from public.organization_members where user_id = '93000000-0000-4000-8000-000000000007'::uuid), 'queued', clock_timestamp(), clock_timestamp()) $$, '23514', 'queued Agent invocation cannot have completed_at');
select throws_ok($$ update public.agent_invocations set status = 'failed' $$, '42501', 'service role cannot update Agent invocations');
select throws_ok($$ delete from public.agent_invocations $$, '42501', 'service role cannot delete Agent invocations');
select throws_ok($$ truncate public.agent_invocations $$, '42501', 'service role cannot truncate Agent invocations');
select lives_ok($$ insert into public.agent_execution_logs (tenant_id, organization_id, invocation_id, event_type) values ((select tenant_id from public.agent_invocations where input_summary = 'security-fixture-invocation'), (select organization_id from public.agent_invocations where input_summary = 'security-fixture-invocation'), (select id from public.agent_invocations where input_summary = 'security-fixture-invocation'), 'security.append_test') returning id $$, 'service role appends the explicit Agent execution-log fixture');
select is((select count(*) from public.agent_execution_logs where event_type = 'security.append_test'), 1::bigint, 'service execution-log INSERT RETURNING fixture added exactly one row');
select throws_ok($$ update public.agent_execution_logs set event_type = 'mutated' $$, '42501', 'service role cannot update Agent execution logs');
select throws_ok($$ delete from public.agent_execution_logs $$, '42501', 'service role cannot delete Agent execution logs');
select throws_ok($$ truncate public.agent_execution_logs $$, '42501', 'service role cannot truncate Agent execution logs');
reset role;

select lives_ok($$ alter table public.agent_invocations drop constraint agent_invocations_terminal_completion_check $$, 'test transaction can create a pre-constraint terminal invocation');
select lives_ok($$ alter table public.agent_invocations disable trigger agent_invocations_append_only $$, 'owner disables only the invocation append trigger for the legacy backfill fixture');
insert into public.agent_invocations (
  tenant_id, organization_id, agent_id, actor_member_id, status, input_summary,
  latency_ms, started_at, completed_at, created_at
)
values (
  (select tenant_id from public.agent_definitions where code = 'security-pgtap-execution-fixture'),
  (select organization_id from public.agent_definitions where code = 'security-pgtap-execution-fixture'),
  (select id from public.agent_definitions where code = 'security-pgtap-execution-fixture'),
  (select id from public.organization_members where user_id = '93000000-0000-4000-8000-000000000007'::uuid),
  'succeeded', 'security-legacy-terminal', 750,
  timestamptz '2026-08-01 00:00:00+00', null, timestamptz '2026-08-01 00:10:00+00'
);
select lives_ok($$ select public.backfill_agent_invocation_timestamps() $$, 'owner backfills the legacy terminal fixture while its append trigger is disabled');
select lives_ok($$ alter table public.agent_invocations enable trigger agent_invocations_append_only $$, 'owner immediately restores the invocation append trigger after backfill');
select is((select started_at from public.agent_invocations where input_summary = 'security-legacy-terminal'), timestamptz '2026-08-01 00:09:59.250+00', 'historical terminal starts before its created-at completion by its latency');
select is((select completed_at from public.agent_invocations where input_summary = 'security-legacy-terminal'), timestamptz '2026-08-01 00:10:00+00', 'historical terminal completes at its historical creation point');
select throws_ok($$ update public.agent_invocations set output_summary = 'must remain immutable' where input_summary = 'security-legacy-terminal' $$, '42501', 'owner sees the restored invocation trigger reject updates');

select * from finish();

rollback;
