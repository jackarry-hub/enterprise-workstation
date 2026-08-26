begin;

select plan(4);

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
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where role.organization_id is null
      and role.code = 'owner'
      and permission.code = any (array[
        'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
        'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
        'agent.orchestrate', 'analytics.read', 'settings.manage'
      ]::text[])
  ),
  11::bigint,
  'owner receives every commercial permission'
);

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where role.organization_id is null
      and role.code = 'admin'
      and permission.code = any (array[
        'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
        'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
        'agent.orchestrate', 'analytics.read', 'settings.manage'
      ]::text[])
  ),
  11::bigint,
  'admin receives every commercial permission'
);

select is(
  (
    select count(*)
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
    where role.organization_id is null
      and role.code = 'employee'
      and permission.code = any (array[
        'ai.config.manage', 'role.manage', 'customer.manage', 'approval.submit',
        'approval.act', 'expense.manage', 'knowledge.manage', 'agent.manage',
        'agent.orchestrate', 'analytics.read', 'settings.manage'
      ]::text[])
  ),
  0::bigint,
  'employee receives no commercial management permissions'
);

select * from finish();

rollback;
