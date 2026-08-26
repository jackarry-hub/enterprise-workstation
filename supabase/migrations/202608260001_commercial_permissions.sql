insert into public.permissions (code, name, module, action)
values
  ('ai.config.manage', '管理 AI 配置', 'ai', 'config.manage'),
  ('role.manage', '管理角色与权限', 'roles', 'manage'),
  ('customer.manage', '管理客户', 'customers', 'manage'),
  ('approval.submit', '提交审批', 'approvals', 'submit'),
  ('approval.act', '处理审批', 'approvals', 'act'),
  ('expense.manage', '管理费用报销', 'expenses', 'manage'),
  ('knowledge.manage', '管理知识库', 'knowledge', 'manage'),
  ('agent.manage', '管理智能体', 'agents', 'manage'),
  ('agent.orchestrate', '编排智能体', 'agents', 'orchestrate'),
  ('analytics.read', '查看经营分析', 'analytics', 'read'),
  ('settings.manage', '管理系统设置', 'settings', 'manage')
on conflict (code) do update
set name = excluded.name,
    module = excluded.module,
    action = excluded.action;

insert into public.role_permissions (tenant_id, role_id, permission_id)
select role.tenant_id, role.id, permission.id
from public.roles role
join public.permissions permission on permission.code = any (array[
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
where role.organization_id is null
  and role.code in ('owner', 'admin')
on conflict do nothing;
