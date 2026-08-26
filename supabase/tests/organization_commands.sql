begin;

select plan(25);

insert into public.tenants (name, slug, status)
values ('Organization command tenant A', 'organization-command-a', 'active'),
       ('Organization command tenant B', 'organization-command-b', 'active');

insert into public.organizations (tenant_id, name, slug)
select tenant.id, seed.name, seed.slug
from public.tenants tenant
join (values
  ('organization-command-a', 'Organization command A', 'organization-command-org-a'),
  ('organization-command-b', 'Organization command B', 'organization-command-org-b')
) as seed(tenant_slug, name, slug) on seed.tenant_slug = tenant.slug;

insert into public.identity_providers (tenant_id, provider_code, auth_provider, provider_tenant_key, display_name)
select tenant.id, 'organizationcommand', 'custom:organizationcommand', tenant.slug || '-key', 'Organization command test auth'
from public.tenants tenant where tenant.slug in ('organization-command-a', 'organization-command-b');

insert into public.roles (tenant_id, organization_id, code, name, description, is_system, is_enabled)
select tenant.id, null, seed.code, seed.name, seed.name, true, true
from public.tenants tenant
cross join (values ('owner', 'Owner'), ('admin', 'Admin'), ('employee', 'Employee'), ('hr', 'HR')) as seed(code, name)
where tenant.slug in ('organization-command-a', 'organization-command-b');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'organization-command-employee@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'organization-command-admin@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'organization-command-owner@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, seed.user_id, 'active'
from (values
  ('organization-command-a', 'organization-command-org-a', '97000000-0000-4000-8000-000000000001'::uuid),
  ('organization-command-a', 'organization-command-org-a', '97000000-0000-4000-8000-000000000002'::uuid),
  ('organization-command-a', 'organization-command-org-a', '97000000-0000-4000-8000-000000000003'::uuid)
) as seed(tenant_slug, organization_slug, user_id)
join public.tenants tenant on tenant.slug = seed.tenant_slug
join public.organizations organization on organization.tenant_id = tenant.id and organization.slug = seed.organization_slug;

insert into public.member_roles (tenant_id, member_id, role_id)
select member.tenant_id, member.id, role.id
from public.organization_members member
join public.roles role on role.tenant_id = member.tenant_id
join (values
  ('97000000-0000-4000-8000-000000000001'::uuid, 'employee'),
  ('97000000-0000-4000-8000-000000000002'::uuid, 'admin'),
  ('97000000-0000-4000-8000-000000000003'::uuid, 'owner')
) as seed(user_id, role_code) on seed.user_id = member.user_id and seed.role_code = role.code;

insert into public.employee_profiles (
  tenant_id, organization_id, organization_member_id, employee_no, display_name, job_title, employment_status, skills
)
select member.tenant_id, member.organization_id, member.id, 'ORG-' || member.id, 'Organization command member', 'Tester', 'active', '{}'::text[]
from public.organization_members member
where member.user_id in (
  '97000000-0000-4000-8000-000000000001'::uuid,
  '97000000-0000-4000-8000-000000000002'::uuid,
  '97000000-0000-4000-8000-000000000003'::uuid
);

insert into public.external_identities (
  tenant_id, organization_id, organization_member_id, identity_provider_id,
  provider_subject, provider_tenant_key, auth_user_id, status
)
select member.tenant_id, member.organization_id, member.id, provider.id,
  member.user_id::text, provider.provider_tenant_key, member.user_id, 'active'
from public.organization_members member
join public.identity_providers provider on provider.tenant_id = member.tenant_id and provider.provider_code = 'organizationcommand';

insert into public.departments (tenant_id, organization_id, code, name, description)
select tenant.id, organization.id, 'FOREIGN', 'Foreign real department', 'Cross tenant fixture'
from public.tenants tenant join public.organizations organization on organization.tenant_id = tenant.id
where tenant.slug = 'organization-command-b' and organization.slug = 'organization-command-org-b';
select set_config('test.organization_commands.foreign_department_id', (
  select public_id::text from public.departments where code = 'FOREIGN'
), true);

insert into public.position_templates (
  tenant_id, organization_id, code, name, category, description, source, status
)
select tenant.id, organization.id, 'FS-OWNED', 'Feishu owned role', 'Directory', 'Provider owned', 'feishu', 'active'
from public.tenants tenant join public.organizations organization on organization.tenant_id = tenant.id
where tenant.slug = 'organization-command-a' and organization.slug = 'organization-command-org-a';
select set_config('test.organization_commands.feishu_position_id', (
  select public_id::text from public.position_templates where code = 'FS-OWNED'
), true);

select ok(
  has_function('public', 'create_current_department', array['text','text','text','integer','uuid']::name[])
  and has_function('public', 'update_current_department', array['uuid','text','text','integer','bigint','uuid']::name[])
  and has_function('public', 'upsert_current_position', array['uuid','text','text','text','text','uuid','bigint','uuid']::name[])
  and has_function('public', 'assign_current_member_role', array['bigint','text','bigint','uuid']::name[]),
  'organization commands expose the exact tenant-derived RPC signatures'
);
select ok(
  has_function_privilege('authenticated', 'public.create_current_department(text,text,text,integer,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.assign_current_member_role(bigint,text,bigint,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_current_department(text,text,text,integer,uuid)', 'EXECUTE'),
  'only authenticated callers can execute organization commands'
);

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$ select public.create_current_department('OPS', 'Operations', '', 0, '97000000-0000-4000-8000-000000000001'::uuid) $$,
  '42501', 'Organization command permission required', 'employee is denied before a department write'
);
reset role;
select is((select count(*) from public.departments where code = 'OPS'), 0::bigint, 'employee denial leaves no department side effect');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$ select public.create_current_department('OPS', 'Operations', 'QuantXY owned description', 3, '97000000-0000-4000-8000-000000000002'::uuid) $$,
  'admin creates a manual department'
);
reset role;
select is((select version from public.departments where code = 'OPS'), 1::bigint, 'department creation starts at version one');
select ok(exists (
  select 1 from public.audit_logs where action = 'organization.department_created'
    and request_id = '97000000-0000-4000-8000-000000000002'::uuid
    and metadata ? 'idempotencyKey'
), 'department creation is transactionally audited with its idempotency key');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$ select public.update_current_department((select public_id from public.departments where code = 'OPS'), 'Operations', '', 3, 2, '97000000-0000-4000-8000-000000000003'::uuid) $$,
  '40001', 'Department version is stale', 'stale department versions fail closed'
);
select lives_ok(
  $$ select public.update_current_department((select public_id from public.departments where code = 'OPS'), 'Operations updated', 'Manual notes', 4, 1, '97000000-0000-4000-8000-000000000004'::uuid) $$,
  'current department version updates'
);
reset role;
select is((select version from public.departments where code = 'OPS'), 2::bigint, 'department update increments its version');
select ok(exists (
  select 1 from public.audit_logs where action = 'organization.department_updated'
    and request_id = '97000000-0000-4000-8000-000000000004'::uuid
    and metadata ? 'before' and metadata ? 'after'
), 'department update audit contains a safe before and after summary');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$ select public.update_current_department(current_setting('test.organization_commands.foreign_department_id')::uuid, 'Nope', '', 0, 1, '97000000-0000-4000-8000-000000000005'::uuid) $$,
  'P0002', 'Organization target not found', 'foreign real department id returns not found'
);
select lives_ok(
  $$ select public.upsert_current_position(null, 'OPS-1', 'Operations Specialist', 'Operations', 'Manual position', null, 0, '97000000-0000-4000-8000-000000000006'::uuid) $$,
  'admin creates a manual position'
);
select throws_ok(
  $$ select public.upsert_current_position(current_setting('test.organization_commands.feishu_position_id')::uuid, 'FS-OWNED', 'Changed', 'Directory', '', null, 1, '97000000-0000-4000-8000-000000000007'::uuid) $$,
  '42501', 'Feishu owned position cannot be changed manually', 'Feishu owned position mutation fails closed'
);
reset role;
select is((select source from public.position_templates where code = 'OPS-1'), 'manual', 'manual position retains its QuantXY-owned source');
select ok(exists (
  select 1 from public.audit_logs where action = 'organization.position_upserted'
    and request_id = '97000000-0000-4000-8000-000000000006'::uuid
), 'manual position create is audited');
select is((select count(*) from public.audit_logs where request_id in (
  '97000000-0000-4000-8000-000000000005'::uuid,
  '97000000-0000-4000-8000-000000000007'::uuid
)), 0::bigint, 'not-found and Feishu-denied commands leave no audit side effects');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$ select public.assign_current_member_role((select id from public.organization_members where user_id = '97000000-0000-4000-8000-000000000001'::uuid), 'hr', 1, '97000000-0000-4000-8000-000000000008'::uuid) $$,
  'admin assigns a current member role'
);
select throws_ok(
  $$ select public.assign_current_member_role((select id from public.organization_members where user_id = '97000000-0000-4000-8000-000000000001'::uuid), 'employee', 1, '97000000-0000-4000-8000-000000000009'::uuid) $$,
  '40001', 'Role version is stale', 'stale member role versions fail closed'
);
select throws_ok(
  $$ select public.assign_current_member_role((select id from public.organization_members where user_id = '97000000-0000-4000-8000-000000000003'::uuid), 'hr', 1, '97000000-0000-4000-8000-000000000010'::uuid) $$,
  '42501', 'Owner role cannot be changed here', 'owner role is protected from assignment command'
);
reset role;
select is((select role_version from public.organization_members where user_id = '97000000-0000-4000-8000-000000000001'::uuid), 2::bigint, 'role assignment increments the target version');
select is((select role.code from public.member_roles assignment join public.roles role on role.id = assignment.role_id where assignment.member_id = (select id from public.organization_members where user_id = '97000000-0000-4000-8000-000000000001'::uuid)), 'hr', 'role assignment stores the requested global system role');
select ok(exists (
  select 1 from public.audit_logs where action = 'organization.role_assigned'
    and request_id = '97000000-0000-4000-8000-000000000008'::uuid
    and metadata ? 'before' and metadata ? 'after'
), 'role assignment is audited with safe before and after summaries');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$ select public.create_current_department('DUP', 'Duplicate', '', 0, '97000000-0000-4000-8000-000000000002'::uuid) $$,
  '23505', null, 'tenant operation idempotency uniqueness rejects a reused key'
);
reset role;
select is((select count(*) from public.audit_logs where request_id = '97000000-0000-4000-8000-000000000002'::uuid), 1::bigint, 'duplicate command key leaves exactly one audit event');

select * from finish();
rollback;
