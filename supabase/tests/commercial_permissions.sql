begin;

select plan(12);

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
  ('employee', 'Test employee', 'Commercial baseline test employee')
) as seed(code, name, description)
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

update public.roles role
set organization_id = (
  select organization.id
  from public.organizations organization
  join public.tenants tenant on tenant.id = organization.tenant_id
  where tenant.slug = 'commercial-baseline-test'
    and organization.slug = 'commercial-baseline-org'
)
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
  'making an owner organization-scoped revokes every commercial permission'
);

update public.roles role
set organization_id = null
where role.tenant_id = (
  select id from public.tenants where slug = 'commercial-baseline-test'
)
  and role.code = 'owner';

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

select ok(
  pg_get_functiondef('public.current_workspace_access()'::regprocedure)
    ~ '(?s)''permissionCodes''.*?join public\.roles role.*?role\.is_enabled',
  'workspace access excludes disabled roles from aggregated permissions'
);

select * from finish();

rollback;
