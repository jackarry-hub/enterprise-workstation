begin;

select plan(5);

select is(
  (
    select array_agg(permission.code order by permission.code)
    from public.permissions permission
    where permission.code = any (array[
      'ai.config.manage',
      'role.manage',
      'customer.manage',
      'approval.submit',
      'approval.act',
      'expense.manage',
      'knowledge.manage',
      'agent.manage',
      'agent.orchestrate',
      'analytics.read',
      'settings.manage'
    ]::text[])
  ),
  array[
    'agent.manage',
    'agent.orchestrate',
    'ai.config.manage',
    'analytics.read',
    'approval.act',
    'approval.submit',
    'customer.manage',
    'expense.manage',
    'knowledge.manage',
    'role.manage',
    'settings.manage'
  ]::text[],
  'commercial permission catalog is seeded exactly once'
);

select is(
  (
    select count(*)
    from public.roles role
    where role.organization_id is null
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
    where role.organization_id is null
      and role.code in ('owner', 'admin')
  ),
  'every tenant system owner and admin has the complete commercial baseline'
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

insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system
)
select tenant.id, null, seed.code, seed.name, seed.description, true
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
  'new tenant owner and admin receive the baseline through system-role provisioning'
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

select * from finish();

rollback;
