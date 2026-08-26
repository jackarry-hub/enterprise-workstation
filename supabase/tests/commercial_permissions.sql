begin;

select plan(41);

select is(
  (
    select array_agg(permission.code order by permission.code)
    from public.permissions permission
    where permission.code = any (array[
      'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
      'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
      'agent.orchestrate', 'analytics.read', 'settings.manage'
    ]::text[])
  ),
  array[
    'agent.manage', 'agent.orchestrate', 'ai.config.manage', 'analytics.read',
    'approval.act', 'approval.submit', 'customer.manage', 'expense.manage',
    'knowledge.manage', 'role.manage', 'settings.manage'
  ]::text[],
  'commercial permission catalog is seeded exactly once'
);

select is(
  (
    select count(*)
    from public.roles role
    where role.is_system
      and role.is_enabled
      and role.organization_id is null
      and role.code in ('owner', 'admin')
      and (
        select count(distinct permission.code)
        from public.role_permissions assignment
        join public.permissions permission on permission.id = assignment.permission_id
        where assignment.tenant_id = role.tenant_id
          and assignment.role_id = role.id
          and permission.code = any (array[
            'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
            'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
            'agent.orchestrate', 'analytics.read', 'settings.manage'
          ]::text[])
      ) = 11
  ),
  (
    select count(*)
    from public.roles role
    where role.is_system
      and role.is_enabled
      and role.organization_id is null
      and role.code in ('owner', 'admin')
  ),
  'every eligible tenant system owner and admin has the complete commercial baseline'
);

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where assignment.tenant_id = role.tenant_id
      and role.organization_id is null
      and role.code = 'employee'
      and permission.code = any (array[
        'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
        'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
        'agent.orchestrate', 'analytics.read', 'settings.manage'
      ]::text[])
  ),
  0::bigint,
  'employees in every tenant receive no commercial management permissions'
);

insert into public.tenants (name, slug, status)
values ('Commercial baseline test tenant', 'commercial-baseline-test', 'active');

insert into public.organizations (tenant_id, name, slug)
select tenant.id, 'Commercial baseline organization', 'commercial-baseline-org'
from public.tenants tenant
where tenant.slug = 'commercial-baseline-test';

insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select tenant.id, null, seed.code, seed.name, seed.description, true, true
from public.tenants tenant
cross join (values
  ('owner', 'Test owner', 'Commercial baseline test owner'),
  ('admin', 'Test admin', 'Commercial baseline test admin'),
  ('employee', 'Test employee', 'Commercial baseline test employee'),
  ('hr', 'Test HR', 'Commercial baseline test HR')
) as seed(code, name, description)
where tenant.slug = 'commercial-baseline-test';

insert into public.role_permissions (tenant_id, role_id, permission_id)
select tenant.id, role.id, permission.id
from public.tenants tenant
join public.roles role
  on role.tenant_id = tenant.id
  and role.code = 'employee'
join public.permissions permission on permission.code = 'task.manage'
where tenant.slug = 'commercial-baseline-test';

select is(
  (
    select count(*)
    from public.roles role
    where role.tenant_id = (
      select id from public.tenants where slug = 'commercial-baseline-test'
    )
      and role.is_system
      and role.is_enabled
      and role.organization_id is null
      and role.code in ('owner', 'admin')
      and (
        select count(distinct permission.code)
        from public.role_permissions assignment
        join public.permissions permission on permission.id = assignment.permission_id
        where assignment.tenant_id = role.tenant_id
          and assignment.role_id = role.id
          and permission.code = any (array[
            'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
            'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
            'agent.orchestrate', 'analytics.read', 'settings.manage'
          ]::text[])
      ) = 11
  ),
  2::bigint,
  'new tenant active system owner and admin receive the baseline'
);

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where assignment.tenant_id = role.tenant_id
      and role.tenant_id = (
        select id from public.tenants where slug = 'commercial-baseline-test'
      )
      and role.code = 'employee'
      and permission.code = any (array[
        'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
        'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
        'agent.orchestrate', 'analytics.read', 'settings.manage'
      ]::text[])
  ),
  0::bigint,
  'new tenant employee receives no commercial management permissions'
);

update public.roles role
set is_enabled = false
where role.tenant_id = (
  select id from public.tenants where slug = 'commercial-baseline-test'
)
  and role.code = 'owner';

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where assignment.tenant_id = role.tenant_id
      and role.tenant_id = (
        select id from public.tenants where slug = 'commercial-baseline-test'
      )
      and role.code = 'owner'
      and permission.code = any (array[
        'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
        'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
        'agent.orchestrate', 'analytics.read', 'settings.manage'
      ]::text[])
  ),
  0::bigint,
  'disabling an owner revokes every commercial permission'
);

update public.roles role
set is_enabled = true
where role.tenant_id = (
  select id from public.tenants where slug = 'commercial-baseline-test'
)
  and role.code = 'owner';

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where assignment.tenant_id = role.tenant_id
      and role.tenant_id = (
        select id from public.tenants where slug = 'commercial-baseline-test'
      )
      and role.code = 'owner'
      and permission.code = any (array[
        'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
        'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
        'agent.orchestrate', 'analytics.read', 'settings.manage'
      ]::text[])
  ),
  11::bigint,
  're-enabling an owner restores the complete commercial baseline'
);

select throws_ok(
  $$
    update public.roles role
    set organization_id = organization.id
    from public.organizations organization
    join public.tenants tenant on tenant.id = organization.tenant_id
    where tenant.slug = 'commercial-baseline-test'
      and organization.slug = 'commercial-baseline-org'
      and role.tenant_id = tenant.id
      and role.code = 'owner'
  $$,
  '23514',
  'Canonical workspace role codes require a global system role',
  'a canonical owner cannot be made organization-scoped'
);

update public.roles role
set code = 'commercial_test_role'
where role.tenant_id = (
  select id from public.tenants where slug = 'commercial-baseline-test'
)
  and role.code = 'owner';

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where assignment.tenant_id = role.tenant_id
      and role.tenant_id = (
        select id from public.tenants where slug = 'commercial-baseline-test'
      )
      and role.code = 'commercial_test_role'
      and permission.code = any (array[
        'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
        'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
        'agent.orchestrate', 'analytics.read', 'settings.manage'
      ]::text[])
  ),
  0::bigint,
  'changing an owner code revokes every commercial permission'
);

insert into public.tenants (name, slug, status)
values ('Commercial baseline target tenant', 'commercial-baseline-target', 'active');

update public.roles role
set tenant_id = (
  select id from public.tenants where slug = 'commercial-baseline-target'
)
where role.tenant_id = (
  select id from public.tenants where slug = 'commercial-baseline-test'
)
  and role.code = 'admin';

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where assignment.tenant_id = role.tenant_id
      and role.tenant_id = (
        select id from public.tenants where slug = 'commercial-baseline-target'
      )
      and role.code = 'admin'
      and permission.code = any (array[
        'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
        'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
        'agent.orchestrate', 'analytics.read', 'settings.manage'
      ]::text[])
  ),
  11::bigint,
  'moving an active system admin to another tenant restores its complete baseline'
);

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.tenant_id = (
      select id from public.tenants where slug = 'commercial-baseline-test'
    )
      and role.tenant_id = (
        select id from public.tenants where slug = 'commercial-baseline-target'
      )
      and role.code = 'admin'
  ),
  0::bigint,
  'moving a system admin leaves no stale old-tenant assignments'
);

insert into public.role_permissions (tenant_id, role_id, permission_id)
select tenant.id, role.id, permission.id
from public.tenants tenant
join public.roles role
  on role.tenant_id = tenant.id and role.code = 'hr'
join public.permissions permission on permission.code = 'agent.orchestrate'
where tenant.slug = 'commercial-baseline-test';

insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select tenant.id, null, 'custom_observer', 'Custom observer',
  'Ordinary custom role with no commercial baseline', false, true
from public.tenants tenant
where tenant.slug = 'commercial-baseline-test';

update public.roles role
set is_enabled = true
where role.tenant_id = (
  select id from public.tenants where slug = 'commercial-baseline-test'
)
  and role.code = 'hr';

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where assignment.tenant_id = role.tenant_id
      and role.tenant_id = (
        select id from public.tenants where slug = 'commercial-baseline-test'
      )
      and role.code = 'hr'
      and permission.code = 'agent.orchestrate'
  ),
  1::bigint,
  'an ordinary HR role keeps its explicit commercial permission across unrelated role changes'
);

insert into public.departments (tenant_id, organization_id, code, name)
select tenant.id, organization.id, 'COM', 'Commercial test department'
from public.tenants tenant
join public.organizations organization
  on organization.tenant_id = tenant.id
where tenant.slug = 'commercial-baseline-test'
  and organization.slug = 'commercial-baseline-org';

insert into public.identity_providers (
  tenant_id, provider_code, auth_provider, provider_tenant_key, display_name
)
select tenant.id, 'testauth', 'custom:testauth', 'commercial-baseline-key',
  'Commercial test auth'
from public.tenants tenant
where tenant.slug = 'commercial-baseline-test';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '22000000-0000-4000-8000-000000000001'::uuid,
  'authenticated', 'authenticated', 'commercial-session@example.test',
  crypt('local-e2e-password', gen_salt('bf')), now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

select public.provision_employee_identity(
  'commercial-baseline-test', 'commercial-baseline-org',
  'COM-EMPLOYEE', 'Commercial session employee', 'COM', 'Test employee',
  'employee', 'testauth', 'commercial-baseline-key', 'commercial-session-subject',
  array['commercial-session-match'], '{}'::text[], 'commercial-session@example.test'
);

select public.bind_preprovisioned_identity(
  'commercial-baseline-test', 'testauth', 'commercial-baseline-key',
  'commercial-session-subject', '22000000-0000-4000-8000-000000000001'::uuid
);

insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select tenant.id, null, 'disabled_commercial', 'Disabled commercial role',
  'Disabled role used to verify workspace permission aggregation', false, false
from public.tenants tenant
where tenant.slug = 'commercial-baseline-test';

insert into public.member_roles (tenant_id, member_id, role_id)
select tenant.id, member.id, role.id
from public.tenants tenant
join public.employee_profiles profile
  on profile.tenant_id = tenant.id and profile.employee_no = 'COM-EMPLOYEE'
join public.organization_members member
  on member.tenant_id = profile.tenant_id and member.id = profile.organization_member_id
join public.roles role
  on role.tenant_id = tenant.id and role.code = 'disabled_commercial'
where tenant.slug = 'commercial-baseline-test';

insert into public.role_permissions (tenant_id, role_id, permission_id)
select tenant.id, role.id, permission.id
from public.tenants tenant
join public.roles role
  on role.tenant_id = tenant.id and role.code = 'disabled_commercial'
join public.permissions permission on permission.code = 'agent.orchestrate'
where tenant.slug = 'commercial-baseline-test';

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where assignment.tenant_id = role.tenant_id
      and role.code = 'disabled_commercial'
      and permission.code = 'agent.orchestrate'
  ),
  1::bigint,
  'disabled role holds the commercial permission before workspace aggregation'
);

insert into public.organizations (tenant_id, name, slug)
select tenant.id, 'Commercial secondary organization', 'commercial-baseline-org-secondary'
from public.tenants tenant
where tenant.slug = 'commercial-baseline-test';

insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select tenant.id, organization.id, seed.code, seed.name, seed.description, false, true
from public.tenants tenant
join public.organizations organization on organization.tenant_id = tenant.id
cross join (values
  ('same_org_reviewer', 'Same organization reviewer', 'Scoped role for the member organization'),
  ('other_org_reviewer', 'Other organization reviewer', 'Scoped role for a different organization')
) as seed(code, name, description)
where tenant.slug = 'commercial-baseline-test'
  and (
    (organization.slug = 'commercial-baseline-org' and seed.code = 'same_org_reviewer')
    or (
      organization.slug = 'commercial-baseline-org-secondary'
      and seed.code = 'other_org_reviewer'
    )
  );

insert into public.role_permissions (tenant_id, role_id, permission_id)
select tenant.id, role.id, permission.id
from public.tenants tenant
join public.roles role
  on role.tenant_id = tenant.id and role.code = 'same_org_reviewer'
join public.permissions permission on permission.code = 'approval.submit'
where tenant.slug = 'commercial-baseline-test';

select throws_ok(
  $$
    insert into public.roles (
      tenant_id, organization_id, code, name, description, is_system, is_enabled
    )
    select tenant.id, organization.id, 'admin', 'Scoped custom admin collision',
      'Must not impersonate the canonical administrator role', false, true
    from public.tenants tenant
    join public.organizations organization on organization.tenant_id = tenant.id
    where tenant.slug = 'commercial-baseline-test'
      and organization.slug = 'commercial-baseline-org'
  $$,
  '23514',
  'Canonical workspace role codes require a global system role',
  'a scoped custom admin collision is rejected'
);

select throws_ok(
  $$
    insert into public.roles (
      tenant_id, organization_id, code, name, description, is_system, is_enabled
    )
    select tenant.id, organization.id, 'employee', 'Scoped custom employee collision',
      'Must not impersonate the canonical employee role', false, true
    from public.tenants tenant
    join public.organizations organization on organization.tenant_id = tenant.id
    where tenant.slug = 'commercial-baseline-test'
      and organization.slug = 'commercial-baseline-org'
  $$,
  '23514',
  'Canonical workspace role codes require a global system role',
  'a scoped custom employee collision is rejected'
);

select lives_ok(
  $$
    insert into public.member_roles (tenant_id, member_id, role_id)
    select tenant.id, member.id, role.id
    from public.tenants tenant
    join public.employee_profiles profile
      on profile.tenant_id = tenant.id and profile.employee_no = 'COM-EMPLOYEE'
    join public.organization_members member
      on member.tenant_id = profile.tenant_id and member.id = profile.organization_member_id
    join public.roles role
      on role.tenant_id = tenant.id and role.code = 'same_org_reviewer'
    where tenant.slug = 'commercial-baseline-test'
  $$,
  'same-organization scoped role assignment is accepted'
);

select throws_ok(
  $$
    insert into public.member_roles (tenant_id, member_id, role_id)
    select tenant.id, member.id, role.id
    from public.tenants tenant
    join public.employee_profiles profile
      on profile.tenant_id = tenant.id and profile.employee_no = 'COM-EMPLOYEE'
    join public.organization_members member
      on member.tenant_id = profile.tenant_id and member.id = profile.organization_member_id
    join public.roles role
      on role.tenant_id = tenant.id and role.code = 'other_org_reviewer'
    where tenant.slug = 'commercial-baseline-test'
  $$,
  '23514',
  'Member role organization must be global or match the member organization',
  'cross-organization scoped role assignment is rejected'
);

alter table public.roles disable trigger roles_canonical_workspace_role_shape;
insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select tenant.id, organization.id, 'admin', 'Historical scoped admin collision',
  'A legacy collision is excluded from canonical workspace identity', false, true
from public.tenants tenant
join public.organizations organization on organization.tenant_id = tenant.id
where tenant.slug = 'commercial-baseline-test'
  and organization.slug = 'commercial-baseline-org';
alter table public.roles enable trigger roles_canonical_workspace_role_shape;

insert into public.member_roles (tenant_id, member_id, role_id)
select tenant.id, member.id, role.id
from public.tenants tenant
join public.employee_profiles profile
  on profile.tenant_id = tenant.id and profile.employee_no = 'COM-EMPLOYEE'
join public.organization_members member
  on member.tenant_id = profile.tenant_id and member.id = profile.organization_member_id
join public.roles role
  on role.tenant_id = tenant.id
 and role.organization_id = member.organization_id
 and role.code = 'admin'
 and not role.is_system
where tenant.slug = 'commercial-baseline-test';

select set_config(
  'request.jwt.claim.sub', '22000000-0000-4000-8000-000000000001', true
);

select ok(
  (public.current_workspace_access() -> 'permissionCodes') ? 'task.manage',
  'current workspace access keeps permissions from the enabled global employee role'
);
select ok(
  (public.current_workspace_access() -> 'roleCodes') ? 'employee',
  'current workspace access includes an assigned global role'
);
select ok(
  (public.current_workspace_access() -> 'customRoleCodes') ? 'same_org_reviewer',
  'current workspace access includes an assigned same-organization custom role'
);
select ok(
  (public.current_workspace_access() -> 'permissionCodes') ? 'approval.submit',
  'current workspace access includes permissions from an assigned same-organization role'
);
select ok(
  not ((public.current_workspace_access() -> 'roleCodes') ? 'admin'),
  'a historical scoped admin collision cannot contribute canonical workspace identity'
);
select ok(
  not ((public.current_workspace_access() -> 'customRoleCodes') ? 'admin'),
  'a historical scoped admin collision cannot masquerade as a custom membership'
);
select ok(
  not ((public.current_workspace_access() -> 'permissionCodes') ? 'agent.orchestrate'),
  'current workspace access excludes commercial permissions held only by a disabled role'
);

select has_function(
  'public', 'update_current_ai_provider_config',
  array['text', 'text', 'text', 'text', 'uuid']::name[],
  'the current-user AI configuration command has no tenant parameter'
);
select ok(has_function_privilege(
  'authenticated',
  'public.update_current_ai_provider_config(text,text,text,text,uuid)',
  'EXECUTE'
), 'authenticated users can invoke the tenant-derived AI configuration command');
select ok(not has_function_privilege(
  'anon',
  'public.update_current_ai_provider_config(text,text,text,text,uuid)',
  'EXECUTE'
), 'anonymous users cannot invoke the AI configuration command');

create temporary table ai_config_employee_before as
select count(*) as config_count
from public.ai_provider_configs config
join public.tenants tenant on tenant.public_id = config.tenant_id
where tenant.slug = 'quantxy';
create temporary table ai_config_employee_audit_before as
select count(*) as audit_count
from public.audit_logs audit
join public.tenants tenant on tenant.id = audit.tenant_id
where tenant.slug = 'quantxy'
  and audit.action = 'ai.config.updated';

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$
    select public.update_current_ai_provider_config(
      'deepseek', 'deepseek-chat',
      '{"v":1,"ciphertext":"c2VjcmV0LWNpcGhlcnRleHQtMTIzNDU2Nzg5MA==","iv":"MTIzNDU2Nzg5MDEy"}',
      '7890', '40000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '42501',
  'AI configuration management permission required',
  'ordinary employee cannot change shared AI configuration'
);
reset role;
select is(
  (
    select count(*) from public.ai_provider_configs config
    join public.tenants tenant on tenant.public_id = config.tenant_id
    where tenant.slug = 'quantxy'
  ),
  (select config_count from ai_config_employee_before),
  'employee denial leaves AI configuration unchanged'
);
select is(
  (
    select count(*) from public.audit_logs audit
    join public.tenants tenant on tenant.id = audit.tenant_id
    where tenant.slug = 'quantxy'
      and audit.action = 'ai.config.updated'
  ),
  (select audit_count from ai_config_employee_audit_before),
  'employee denial leaves AI configuration audit history unchanged'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000012', true);
set local role authenticated;
select lives_ok(
  $$
    select public.update_current_ai_provider_config(
      'deepseek', 'deepseek-chat',
      '{"v":1,"ciphertext":"c2VjcmV0LWNpcGhlcnRleHQtMTIzNDU2Nzg5MA==","iv":"MTIzNDU2Nzg5MDEy"}',
      '7890', '40000000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  'authorized admin changes the current tenant AI configuration'
);
reset role;
select is(
  (
    select config.model_name
    from public.ai_provider_configs config
    join public.tenants tenant on tenant.public_id = config.tenant_id
    where tenant.slug = 'quantxy' and config.provider = 'deepseek'
  ),
  'deepseek-chat',
  'admin command stores the requested supported model in its own tenant'
);
select is(
  (
    select config.updated_by
    from public.ai_provider_configs config
    join public.tenants tenant on tenant.public_id = config.tenant_id
    where tenant.slug = 'quantxy' and config.provider = 'deepseek'
  ),
  '11000000-0000-4000-8000-000000000012'::uuid,
  'admin command derives the configuration actor from auth.uid'
);
select ok(exists (
  select 1
  from public.audit_logs audit
  join public.tenants tenant on tenant.id = audit.tenant_id
  where tenant.slug = 'quantxy'
    and audit.action = 'ai.config.updated'
    and audit.actor_auth_user_id = '11000000-0000-4000-8000-000000000012'::uuid
    and audit.request_id = '40000000-0000-4000-8000-000000000002'::uuid
), 'admin command appends an audit event with the current tenant and actor');
select ok(not exists (
  select 1
  from public.audit_logs audit
  where audit.request_id = '40000000-0000-4000-8000-000000000002'::uuid
    and (
      audit.metadata ?| array['encrypted_key', 'ciphertext', 'iv', 'key_hint', 'keyHint']
      or position('c2VjcmV0LWNpcGhlcnRleHQtMTIzNDU2Nzg5MA==' in audit.metadata::text) > 0
      or position('MTIzNDU2Nzg5MDEy' in audit.metadata::text) > 0
      or position('7890' in audit.metadata::text) > 0
    )
), 'AI configuration audit metadata excludes ciphertext IV and key hint');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000012', true);
set local role authenticated;
select throws_ok(
  $$
    select public.update_current_ai_provider_config(
      'deepseek', 'deepseek-reasoner', null, null,
      '40000000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  '23505',
  'request_id has already been used',
  'a duplicate request id is rejected instead of appending another update'
);
select throws_ok(
  $$
    select public.update_current_ai_provider_config(
      'deepseek', 'deepseek-reasoner', 'not-a-versioned-envelope', '7890',
      '40000000-0000-4000-8000-000000000003'::uuid
    )
  $$,
  '22023',
  'encrypted_key must be a version 1 ciphertext envelope',
  'an invalid encrypted key envelope is rejected before configuration or audit writes'
);
reset role;
select is(
  (
    select count(*) from public.audit_logs audit
    where audit.request_id = '40000000-0000-4000-8000-000000000002'::uuid
  ),
  1::bigint,
  'a duplicate request id leaves exactly one audit event'
);
select is(
  (
    select count(*) from public.audit_logs audit
    where audit.request_id = '40000000-0000-4000-8000-000000000003'::uuid
  ),
  0::bigint,
  'an invalid envelope leaves no audit event'
);
select is(
  (
    select config.model_name
    from public.ai_provider_configs config
    join public.tenants tenant on tenant.public_id = config.tenant_id
    where tenant.slug = 'quantxy' and config.provider = 'deepseek'
  ),
  'deepseek-chat',
  'a duplicate idempotency key leaves the original configuration unchanged'
);
select is(
  (
    select count(*)
    from public.ai_provider_configs config
    join public.tenants tenant on tenant.public_id = config.tenant_id
    where tenant.slug = 'commercial-baseline-target'
  ),
  0::bigint,
  'current-user command cannot target another tenant configuration'
);

select set_config('request.jwt.claim.sub', '', true);

select * from finish();

rollback;
