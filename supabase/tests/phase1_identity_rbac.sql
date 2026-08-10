begin;
select no_plan();

select has_table('public', 'tenants', 'tenant root exists');
select has_table('public', 'identity_providers', 'provider registry exists');
select has_table('public', 'external_identities', 'provider-neutral identities exist');
select has_table('public', 'audit_logs', 'tenant audit log exists');
select has_column('public', 'employee_profiles', 'skills', 'employee skills exist');
select has_function('public', 'provision_employee_identity', array[
  'text', 'text', 'text', 'text', 'text', 'text', 'text',
  'text', 'text', 'text', 'text[]', 'text[]', 'text'
]::name[], 'generic provision RPC exists');
select has_function('public', 'bind_preprovisioned_identity', array[
  'text', 'text', 'text', 'text', 'uuid'
]::name[], 'generic service binding RPC exists');
select has_function('public', 'claim_current_identity', array[]::name[], 'generic claim RPC exists');
select has_function('public', 'current_tenant_id', array[]::name[], 'current tenant RPC exists');
select has_function('public', 'current_workspace_access', array[]::name[], 'workspace access RPC exists');

select is((select count(*) from public.tenants where slug = 'quantxy'), 1::bigint, 'one QuantXY tenant seeded');
select is((
  select count(*)
  from public.organizations organization
  join public.tenants tenant on tenant.id = organization.tenant_id
  where tenant.slug = 'quantxy' and organization.slug = 'quantum-galaxy'
), 1::bigint, 'one QuantXY primary organization seeded');
select is((
  select count(*)
  from public.identity_providers provider
  join public.tenants tenant on tenant.id = provider.tenant_id
  where tenant.slug = 'quantxy'
    and provider.provider_code = 'feishu'
    and provider.auth_provider = 'custom:feishu'
), 1::bigint, 'Feishu is the first provider through the generic registry');
select is((
  select count(*)
  from public.departments department
  join public.organizations organization
    on organization.tenant_id = department.tenant_id
   and organization.id = department.organization_id
  where organization.slug = 'quantum-galaxy'
), 5::bigint, 'five departments seeded');

select ok(not has_function_privilege(
  'authenticated',
  'public.provision_employee_identity(text,text,text,text,text,text,text,text,text,text,text[],text[],text)',
  'EXECUTE'
), 'authenticated cannot provision employees');
select ok(has_function_privilege(
  'service_role',
  'public.provision_employee_identity(text,text,text,text,text,text,text,text,text,text,text[],text[],text)',
  'EXECUTE'
), 'service role can provision employees');
select ok(not has_function_privilege(
  'authenticated',
  'public.bind_preprovisioned_identity(text,text,text,text,uuid)',
  'EXECUTE'
), 'authenticated cannot use the administrative binding RPC');
select ok(has_function_privilege(
  'service_role',
  'public.bind_preprovisioned_identity(text,text,text,text,uuid)',
  'EXECUTE'
), 'service role can use the administrative binding RPC');
select ok(has_function_privilege(
  'authenticated', 'public.claim_current_identity()', 'EXECUTE'
), 'authenticated can claim only the current identity');
select ok(has_function_privilege(
  'authenticated', 'public.current_tenant_id()', 'EXECUTE'
), 'authenticated can resolve its current tenant');
select ok(has_function_privilege(
  'authenticated', 'public.current_workspace_access()', 'EXECUTE'
), 'authenticated can read its safe workspace summary');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT'), 'authenticated has no direct audit insert');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE'), 'authenticated has no direct audit update');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'DELETE'), 'authenticated has no direct audit delete');

insert into public.tenants (name, slug, status)
values ('隔离测试租户', 'tenant-isolation-test', 'active');
insert into public.organizations (tenant_id, name, slug)
select id, '隔离测试组织', 'tenant-isolation-organization'
from public.tenants where slug = 'tenant-isolation-test';

select throws_ok(
  $$
    insert into public.organization_members (tenant_id, organization_id, user_id, status)
    select other_tenant.id, quantxy_organization.id, null, 'invited'
    from public.tenants other_tenant
    cross join public.organizations quantxy_organization
    where other_tenant.slug = 'tenant-isolation-test'
      and quantxy_organization.slug = 'quantum-galaxy'
  $$,
  '23503',
  null,
  'same-tenant organization member FK rejects a cross-tenant organization'
);

insert into public.identity_providers (
  tenant_id, provider_code, auth_provider, provider_tenant_key, display_name
)
select id, 'entra', 'custom:entra', 'entra_qxy', 'Microsoft Entra'
from public.tenants where slug = 'quantxy';

with users(id, email) as (values
  ('11000000-0000-4000-8000-000000000001'::uuid, 'owner@example.test'),
  ('11000000-0000-4000-8000-000000000002'::uuid, 'manager@example.test'),
  ('11000000-0000-4000-8000-000000000003'::uuid, 'employee@example.test'),
  ('11000000-0000-4000-8000-000000000004'::uuid, 'finance@example.test'),
  ('11000000-0000-4000-8000-000000000005'::uuid, 'hr@example.test'),
  ('11000000-0000-4000-8000-000000000006'::uuid, 'unknown@example.test'),
  ('11000000-0000-4000-8000-000000000007'::uuid, 'suspended@example.test'),
  ('11000000-0000-4000-8000-000000000008'::uuid, 'departed@example.test'),
  ('11000000-0000-4000-8000-000000000009'::uuid, 'revoked@example.test'),
  ('11000000-0000-4000-8000-000000000010'::uuid, 'entra@example.test'),
  ('11000000-0000-4000-8000-000000000011'::uuid, 'raw-email-only@example.test'),
  ('11000000-0000-4000-8000-000000000012'::uuid, 'admin@example.test')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', id,
  'authenticated', 'authenticated', email,
  crypt('local-e2e-password', gen_salt('bf')), now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
from users;

with identities(user_id, provider, subject, tenant_key, match_key, display_name) as (values
  ('11000000-0000-4000-8000-000000000001'::uuid, 'custom:feishu', 'subject-owner', 'tenant_qxy', 'match-owner', '老板测试'),
  ('11000000-0000-4000-8000-000000000002'::uuid, 'custom:feishu', 'subject-manager', 'tenant_qxy', 'match-manager', '经理测试'),
  ('11000000-0000-4000-8000-000000000003'::uuid, 'custom:feishu', 'subject-employee', 'tenant_qxy', 'match-employee', '员工测试'),
  ('11000000-0000-4000-8000-000000000004'::uuid, 'custom:feishu', 'subject-finance', 'tenant_qxy', 'match-finance', '财务测试'),
  ('11000000-0000-4000-8000-000000000005'::uuid, 'custom:feishu', 'subject-hr', 'tenant_qxy', 'match-hr', '人事测试'),
  ('11000000-0000-4000-8000-000000000006'::uuid, 'custom:feishu', 'subject-unknown', 'tenant_qxy', 'match-unknown', '未知测试'),
  ('11000000-0000-4000-8000-000000000007'::uuid, 'custom:feishu', 'subject-suspended', 'tenant_qxy', 'match-suspended', '停用测试'),
  ('11000000-0000-4000-8000-000000000008'::uuid, 'custom:feishu', 'subject-departed', 'tenant_qxy', 'match-departed', '离职测试'),
  ('11000000-0000-4000-8000-000000000009'::uuid, 'custom:feishu', 'subject-revoked', 'tenant_qxy', 'match-revoked', '撤销测试'),
  ('11000000-0000-4000-8000-000000000010'::uuid, 'custom:entra', 'subject-entra', 'entra_qxy', 'match-entra', 'Entra 测试'),
  ('11000000-0000-4000-8000-000000000012'::uuid, 'custom:feishu', 'subject-admin', 'tenant_qxy', 'match-admin', '管理员测试')
)
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), subject, user_id,
  jsonb_build_object(
    'sub', subject,
    'provider_subject', subject,
    'provider_tenant_key', tenant_key,
    'provider_match_keys', jsonb_build_array(match_key),
    'verified_email', replace(subject, 'subject-', '') || '@example.test',
    'display_name', display_name
  ),
  provider, now(), now(), now()
from identities;

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(), 'subject-raw-email-only',
  '11000000-0000-4000-8000-000000000011'::uuid,
  jsonb_build_object(
    'sub', 'subject-raw-email-only',
    'provider_subject', 'subject-raw-email-only',
    'provider_tenant_key', 'tenant_qxy',
    'provider_match_keys', '[]'::jsonb,
    'email', 'owner@example.test'
  ),
  'custom:feishu', now(), now(), now()
);

select public.provision_employee_identity(
  'quantxy', 'quantum-galaxy', 'QXY-OWNER', '老板测试', 'AI', 'CEO',
  'owner', 'feishu', 'tenant_qxy', 'subject-owner', array['MATCH-OWNER', 'match-owner'],
  array[' Strategy ', 'strategy', 'LEADERSHIP'], 'owner@example.test'
);
select public.provision_employee_identity(
  'quantxy', 'quantum-galaxy', 'QXY-MANAGER', '经理测试', 'AI', '部门负责人',
  'department_head', 'feishu', 'tenant_qxy', 'subject-manager', array['match-manager'],
  array['management'], 'manager@example.test'
);
select public.provision_employee_identity(
  'quantxy', 'quantum-galaxy', 'QXY-EMPLOYEE', '员工测试', 'AI', '员工',
  'employee', 'feishu', 'tenant_qxy', 'subject-employee', array['match-employee'],
  '{}'::text[], 'employee@example.test'
);
select public.provision_employee_identity(
  'quantxy', 'quantum-galaxy', 'QXY-FINANCE', '财务测试', 'FIN', '财务经理',
  'finance', 'feishu', 'tenant_qxy', 'subject-finance', array['match-finance'],
  array['finance'], 'finance@example.test'
);
select public.provision_employee_identity(
  'quantxy', 'quantum-galaxy', 'QXY-HR', '人事测试', 'HR', 'HRBP',
  'hr', 'feishu', 'tenant_qxy', 'subject-hr', array['match-hr'],
  array['people'], 'hr@example.test'
);
select public.provision_employee_identity(
  'quantxy', 'quantum-galaxy', 'QXY-SUSPENDED', '停用测试', 'AI', '员工',
  'employee', 'feishu', 'tenant_qxy', 'subject-suspended', array['match-suspended'],
  '{}'::text[], 'suspended@example.test'
);
select public.provision_employee_identity(
  'quantxy', 'quantum-galaxy', 'QXY-DEPARTED', '离职测试', 'AI', '员工',
  'employee', 'feishu', 'tenant_qxy', 'subject-departed', array['match-departed'],
  '{}'::text[], 'departed@example.test'
);
select public.provision_employee_identity(
  'quantxy', 'quantum-galaxy', 'QXY-REVOKED', '撤销测试', 'AI', '员工',
  'employee', 'feishu', 'tenant_qxy', 'subject-revoked', array['match-revoked'],
  '{}'::text[], 'revoked@example.test'
);
select public.provision_employee_identity(
  'quantxy', 'quantum-galaxy', 'QXY-ENTRA', 'Entra 测试', 'AI', '员工',
  'employee', 'entra', 'entra_qxy', 'subject-entra', array['match-entra'],
  array['identity'], 'entra@example.test'
);
select public.provision_employee_identity(
  'quantxy', 'quantum-galaxy', 'QXY-ADMIN', '管理员测试', 'AI', '系统管理员',
  'owner', 'feishu', 'tenant_qxy', 'subject-admin', array['match-admin'],
  array['identity'], 'admin@example.test'
);
delete from public.member_roles assignment
using public.employee_profiles profile, public.roles role
where profile.employee_no = 'QXY-ADMIN'
  and assignment.tenant_id = profile.tenant_id
  and assignment.member_id = profile.organization_member_id
  and role.tenant_id = assignment.tenant_id
  and role.id = assignment.role_id
  and role.code = 'owner';
insert into public.member_roles (tenant_id, member_id, role_id)
select profile.tenant_id, profile.organization_member_id, role.id
from public.employee_profiles profile
join public.roles role on role.tenant_id = profile.tenant_id
where profile.employee_no = 'QXY-ADMIN'
  and role.code = 'admin'
  and role.organization_id is null;

select is(
  (
    select array_agg(skill order by skill)
    from public.employee_profiles profile,
      unnest(profile.skills) as skill
    where profile.employee_no = 'QXY-OWNER'
  ),
  array['leadership', 'strategy']::text[],
  'skills are trimmed, lowercased, and deduplicated'
);
select is(
  (select skills from public.employee_profiles where employee_no = 'QXY-EMPLOYEE'),
  '{}'::text[],
  'skills default to an empty array'
);
select throws_ok(
  $$
    update public.employee_profiles
    set skills = array_fill('skill'::text, array[31])
    where employee_no = 'QXY-EMPLOYEE'
  $$,
  '22023',
  'Skills cannot contain more than 30 items',
  'skills reject more than 30 raw items before deduplication'
);
select throws_ok(
  $$
    update public.employee_profiles
    set skills = array['   ']
    where employee_no = 'QXY-EMPLOYEE'
  $$,
  '22023',
  'Skills must contain 1 to 40 characters',
  'skills reject empty normalized labels'
);
select throws_ok(
  $$
    update public.employee_profiles
    set skills = array[repeat('x', 41)]
    where employee_no = 'QXY-EMPLOYEE'
  $$,
  '22023',
  'Skills must contain 1 to 40 characters',
  'skills reject labels longer than 40 characters'
);
select throws_ok(
  $$
    update public.employee_profiles
    set skills = array[null]::text[]
    where employee_no = 'QXY-EMPLOYEE'
  $$,
  '22023',
  'Skills must contain 1 to 40 characters',
  'skills reject null array elements'
);

update public.organization_members set status = 'suspended'
where id = (
  select organization_member_id from public.employee_profiles
  where employee_no = 'QXY-SUSPENDED'
);
update public.employee_profiles
set employment_status = 'departed', departure_date = current_date
where employee_no = 'QXY-DEPARTED';
update public.external_identities set status = 'revoked'
where organization_member_id = (
  select organization_member_id from public.employee_profiles
  where employee_no = 'QXY-REVOKED'
);

select throws_ok(
  $$
    insert into public.external_identities (
      tenant_id, organization_id, organization_member_id,
      identity_provider_id, provider_subject, provider_tenant_key
    )
    select
      other_tenant.id, quantxy_organization.id, profile.organization_member_id,
      provider.id, 'cross-tenant-subject', provider.provider_tenant_key
    from public.tenants other_tenant
    cross join public.organizations quantxy_organization
    cross join public.employee_profiles profile
    cross join public.identity_providers provider
    where other_tenant.slug = 'tenant-isolation-test'
      and quantxy_organization.slug = 'quantum-galaxy'
      and profile.employee_no = 'QXY-EMPLOYEE'
      and provider.provider_code = 'feishu'
  $$,
  '23514',
  'External identity member must belong to its tenant and organization',
  'provider identity composite FKs reject cross-tenant references'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select is(public.claim_current_identity(), 'active', 'owner identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'owner', 'owner role returned');
select is(public.current_tenant_id(), (select id from public.tenants where slug = 'quantxy'), 'owner resolves QuantXY tenant');
select is(public.current_workspace_access() ->> 'providerCode', 'feishu', 'workspace access returns provider code');
select ok(not (public.current_workspace_access() ? 'providerTenantKey'), 'workspace access omits provider tenant key');
select ok(not (public.current_workspace_access() ? 'providerMatchKeys'), 'workspace access omits match keys');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select is(public.claim_current_identity(), 'active', 'manager identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'department_head', 'manager role returned');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
select is(public.claim_current_identity(), 'active', 'employee identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'employee', 'employee role returned');
select ok((public.current_workspace_access() -> 'permissionCodes') ? 'task.manage', 'employee permission matrix remains available');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000004', true);
select is(public.claim_current_identity(), 'active', 'finance identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'finance', 'finance role returned');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000005', true);
select is(public.claim_current_identity(), 'active', 'HR identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'hr', 'HR role returned');

create temporary table member_count_before_unknown as
select count(*) as member_count from public.organization_members;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000006', true);
select is(public.claim_current_identity(), 'not_provisioned', 'unknown provider user is rejected');
select is(public.current_workspace_access(), null::jsonb, 'unknown user receives no workspace access');
select is(
  (select count(*) from public.organization_members),
  (select member_count from member_count_before_unknown),
  'unknown user cannot self-register a member'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000007', true);
select is(public.claim_current_identity(), 'suspended', 'suspended member is rejected');
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000008', true);
select is(public.claim_current_identity(), 'departed', 'departed employee is rejected');
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000009', true);
select is(public.claim_current_identity(), 'revoked', 'revoked identity is rejected');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000010', true);
select is(public.claim_current_identity(), 'active', 'a second provider can claim a preprovisioned identity');
select is(public.current_workspace_access() ->> 'providerCode', 'entra', 'second provider remains provider-neutral in workspace access');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000012', true);
select is(public.claim_current_identity(), 'active', 'admin identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'admin', 'admin role returned');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000011', true);
select is(
  public.claim_current_identity(),
  'not_provisioned',
  'raw identity email without normalized verification cannot claim a roster record'
);
select ok(exists (
  select 1 from public.audit_logs
  where action = 'identity.claimed'
    and actor_auth_user_id = '11000000-0000-4000-8000-000000000001'::uuid
), 'identity claim writes an audit event');

select throws_ok(
  $$
    select public.append_audit_log(
      (select id from public.tenants where slug = 'quantxy'),
      (select id from public.organizations where slug = 'quantum-galaxy'),
      null, null, 'roster.imported', 'roster', null, null, null,
      '{"nested":{"Authorization":"redacted-is-not-enough"}}'::jsonb
    )
  $$,
  '22023',
  'Audit metadata contains a sensitive key',
  'nested sensitive audit metadata keys are rejected case-insensitively'
);
select throws_ok(
  $$
    select public.append_audit_log(
      (select id from public.tenants where slug = 'quantxy'),
      (select id from public.organizations where slug = 'quantum-galaxy'),
      null, null, 'roster.imported', 'roster', null, null, null,
      jsonb_build_object('payload', repeat('x', 8200))
    )
  $$,
  '22023',
  'Audit metadata exceeds 8192 bytes',
  'oversized audit metadata is rejected'
);
select throws_ok(
  $$
    select public.append_audit_log(
      (select id from public.tenants where slug = 'quantxy'),
      (select id from public.organizations where slug = 'quantum-galaxy'),
      null, null, 'roster.imported', 'roster', null, null, '203.0.113.9', '{}'::jsonb
    )
  $$,
  '22023',
  'Only an IP HMAC or hash digest may be stored',
  'raw IP addresses cannot be stored'
);
select lives_ok(
  $$
    select public.append_audit_log(
      (select id from public.tenants where slug = 'tenant-isolation-test'),
      (select id from public.organizations where slug = 'tenant-isolation-organization'),
      null, null, 'roster.imported', 'roster', 'tenant-two', null,
      repeat('a', 64), '{"source":"test"}'::jsonb
    )
  $$,
  'controlled audit insertion accepts a hash digest and safe metadata'
);
select throws_ok(
  $$
    select public.append_audit_log(
      (select id from public.tenants where slug = 'tenant-isolation-test'),
      (select id from public.organizations where slug = 'tenant-isolation-organization'),
      '11000000-0000-4000-8000-000000000001'::uuid,
      null, 'roster.imported', 'roster', 'cross-tenant-actor', null,
      null, '{}'::jsonb
    )
  $$,
  '23514',
  'Audit actor must be bound to the same tenant and member',
  'audit events reject an auth actor bound to another tenant'
);
select throws_ok(
  $$ update public.audit_logs set target_id = 'changed' where id = (select min(id) from public.audit_logs) $$,
  '42501',
  'Audit logs are append-only',
  'audit history cannot be updated even by a privileged database actor'
);
select throws_ok(
  $$ delete from public.audit_logs where id = (select min(id) from public.audit_logs) $$,
  '42501',
  'Audit logs are append-only',
  'audit history cannot be deleted even by a privileged database actor'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((
  select count(*) from public.organizations
  where tenant_id = (select id from public.tenants where slug = 'tenant-isolation-test')
), 0::bigint, 'owner cannot read another tenant organization through RLS');
select is((
  select count(*) from public.audit_logs where target_id = 'tenant-two'
), 0::bigint, 'owner cannot read another tenant audit event');
select ok((select count(*) > 0 from public.audit_logs), 'owner can read current-tenant audit events');
select throws_ok(
  $$
    insert into public.audit_logs (
      tenant_id, organization_id, action, target_type, metadata
    )
    select tenant_id, id, 'roster.imported', 'roster', '{}'::jsonb
    from public.organizations where slug = 'quantum-galaxy'
  $$,
  '42501',
  null,
  'authenticated owner cannot bypass controlled audit insertion'
);
reset role;

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000012', true);
set local role authenticated;
select is((
  select count(*) from public.audit_logs where target_id = 'tenant-two'
), 0::bigint, 'admin cannot read another tenant audit event');
select ok((select count(*) > 0 from public.audit_logs), 'admin can read current-tenant audit events');
reset role;

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is((select count(*) from public.audit_logs), 0::bigint, 'ordinary employee cannot read audit events');
reset role;

update public.tenants set status = 'suspended' where slug = 'quantxy';
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select is(public.claim_current_identity(), 'invalid_identity', 'claim rejects an identity from a suspended tenant');
select is(public.current_tenant_id(), null::bigint, 'suspended tenant cannot resolve as current');
select throws_ok(
  $$
    select public.bind_preprovisioned_identity(
      'quantxy', 'feishu', 'tenant_qxy', 'subject-owner',
      '11000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  'P0002',
  null,
  'service binding rejects a suspended tenant'
);
set local role authenticated;
select is((select count(*) from public.organizations), 0::bigint, 'suspended tenant loses organization access through RLS');
reset role;

select * from finish();
rollback;
