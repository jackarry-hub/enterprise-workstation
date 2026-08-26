create or replace function public.ensure_commercial_permission_catalog()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
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
end;
$$;

create or replace function public.grant_commercial_permission_baseline(
  p_tenant_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null then
    raise exception 'Commercial permission baseline requires a tenant'
      using errcode = '22023';
  end if;

  perform public.ensure_commercial_permission_catalog();

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
  where role.tenant_id = p_tenant_id
    and role.organization_id is null
    and role.code in ('owner', 'admin')
  on conflict do nothing;
end;
$$;

create or replace function public.grant_commercial_permissions_on_system_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is null and new.code in ('owner', 'admin') then
    perform public.grant_commercial_permission_baseline(new.tenant_id);
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_commercial_permission_catalog()
  from public, anon, authenticated;
revoke all on function public.grant_commercial_permission_baseline(bigint)
  from public, anon, authenticated;
revoke all on function public.grant_commercial_permissions_on_system_role()
  from public, anon, authenticated;

drop trigger if exists roles_commercial_permission_baseline on public.roles;
create trigger roles_commercial_permission_baseline
after insert or update of tenant_id, organization_id, code on public.roles
for each row execute function public.grant_commercial_permissions_on_system_role();

select public.grant_commercial_permission_baseline(tenant.id)
from public.tenants tenant;
