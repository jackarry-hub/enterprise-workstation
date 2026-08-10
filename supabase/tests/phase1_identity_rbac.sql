begin;
select plan(26);

select has_table('public', 'external_identities', 'external identities exist');
select has_function('public', 'claim_current_feishu_identity', array[]::name[], 'claim RPC exists');
select has_function('public', 'current_workspace_access', array[]::name[], 'access RPC exists');
select policies_are('public', 'external_identities', array['external_identities_self_select']);
select is((select count(*) from public.organizations where slug = 'quantum-galaxy'), 1::bigint, 'one QuantXY seed');
select is((select count(*) from public.departments department join public.organizations organization on organization.id = department.organization_id where organization.slug = 'quantum-galaxy'), 5::bigint, 'five departments seeded');

with users(id, email, open_id, union_id) as (values
  ('11000000-0000-4000-8000-000000000001'::uuid, 'owner@example.test', 'ou_owner', 'on_owner'),
  ('11000000-0000-4000-8000-000000000002'::uuid, 'manager@example.test', 'ou_manager', 'on_manager'),
  ('11000000-0000-4000-8000-000000000003'::uuid, 'employee@example.test', 'ou_employee', 'on_employee'),
  ('11000000-0000-4000-8000-000000000004'::uuid, 'finance@example.test', 'ou_finance', 'on_finance'),
  ('11000000-0000-4000-8000-000000000005'::uuid, 'hr@example.test', 'ou_hr', 'on_hr'),
  ('11000000-0000-4000-8000-000000000006'::uuid, 'unknown@example.test', 'ou_unknown', 'on_unknown'),
  ('11000000-0000-4000-8000-000000000007'::uuid, 'suspended@example.test', 'ou_suspended', 'on_suspended'),
  ('11000000-0000-4000-8000-000000000008'::uuid, 'departed@example.test', 'ou_departed', 'on_departed')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
       crypt('local-e2e-password', gen_salt('bf')), now(),
       '{"provider":"custom:feishu","providers":["custom:feishu"]}'::jsonb,
       '{}'::jsonb, now(), now()
from users;

with identities(user_id, open_id, union_id) as (values
  ('11000000-0000-4000-8000-000000000001'::uuid, 'ou_owner', 'on_owner'),
  ('11000000-0000-4000-8000-000000000002'::uuid, 'ou_manager', 'on_manager'),
  ('11000000-0000-4000-8000-000000000003'::uuid, 'ou_employee', 'on_employee'),
  ('11000000-0000-4000-8000-000000000004'::uuid, 'ou_finance', 'on_finance'),
  ('11000000-0000-4000-8000-000000000005'::uuid, 'ou_hr', 'on_hr'),
  ('11000000-0000-4000-8000-000000000006'::uuid, 'ou_unknown', 'on_unknown'),
  ('11000000-0000-4000-8000-000000000007'::uuid, 'ou_suspended', 'on_suspended'),
  ('11000000-0000-4000-8000-000000000008'::uuid, 'ou_departed', 'on_departed')
)
insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), open_id, user_id,
       jsonb_build_object('sub', open_id, 'open_id', open_id, 'union_id', union_id, 'tenant_key', 'tenant_qxy'),
       'custom:feishu', now(), now(), now()
from identities;

select public.provision_feishu_employee('QXY-OWNER', '老板测试', 'AI', 'CEO', 'owner', 'tenant_qxy', 'on_owner', 'ou_owner', null);
select public.provision_feishu_employee('QXY-MANAGER', '经理测试', 'AI', '部门负责人', 'department_head', 'tenant_qxy', 'on_manager', 'ou_manager', null);
select public.provision_feishu_employee('QXY-EMPLOYEE', '员工测试', 'AI', '员工', 'employee', 'tenant_qxy', 'on_employee', 'ou_employee', null);
select public.provision_feishu_employee('QXY-FINANCE', '财务测试', 'FIN', '财务经理', 'finance', 'tenant_qxy', 'on_finance', 'ou_finance', null);
select public.provision_feishu_employee('QXY-HR', '人事测试', 'HR', 'HRBP', 'hr', 'tenant_qxy', 'on_hr', 'ou_hr', null);
select public.provision_feishu_employee('QXY-SUSPENDED', '停用测试', 'AI', '员工', 'employee', 'tenant_qxy', 'on_suspended', 'ou_suspended', null);
select public.provision_feishu_employee('QXY-DEPARTED', '离职测试', 'AI', '员工', 'employee', 'tenant_qxy', 'on_departed', 'ou_departed', null);

update public.organization_members set status = 'suspended'
where id = (select organization_member_id from public.employee_profiles where employee_no = 'QXY-SUSPENDED');
update public.employee_profiles set employment_status = 'departed', departure_date = current_date
where employee_no = 'QXY-DEPARTED';

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select is(public.claim_current_feishu_identity(), 'active', 'owner identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'owner', 'owner role returned');
select ok(public.has_organization_role((select id from public.organizations where slug = 'quantum-galaxy'), array['owner']), 'owner passes privileged database role check');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select is(public.claim_current_feishu_identity(), 'active', 'manager identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'department_head', 'manager role returned');
select ok(public.has_organization_role((select id from public.organizations where slug = 'quantum-galaxy'), array['department_head']), 'manager passes department database role check');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
select is(public.claim_current_feishu_identity(), 'active', 'employee identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'employee', 'employee role returned');
select ok((public.current_workspace_access() -> 'permissionCodes') ? 'task.manage', 'employee scoped task permission returned');
select is(public.has_organization_role((select id from public.organizations where slug = 'quantum-galaxy'), array['owner', 'finance', 'hr']), false, 'employee fails privileged database role check');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000004', true);
select is(public.claim_current_feishu_identity(), 'active', 'finance identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'finance', 'finance role returned');
select ok(public.has_organization_role((select id from public.organizations where slug = 'quantum-galaxy'), array['finance']), 'finance passes finance database role check');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000005', true);
select is(public.claim_current_feishu_identity(), 'active', 'hr identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'hr', 'hr role returned');
select ok(public.has_organization_role((select id from public.organizations where slug = 'quantum-galaxy'), array['hr']), 'hr passes hr database role check');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000006', true);
select is(public.claim_current_feishu_identity(), 'not_provisioned', 'unknown Feishu user is rejected');
select is(public.current_workspace_access(), null::jsonb, 'unknown user has no workspace access');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000007', true);
select is(public.claim_current_feishu_identity(), 'suspended', 'suspended member is rejected');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000008', true);
select is(public.claim_current_feishu_identity(), 'departed', 'departed employee is rejected');

select * from finish();
rollback;
