-- Enterprise Agent Center:
-- Internal AI control plane with enabled agents, permissions, invocation records and audit logs.

create table public.agent_definitions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  code text not null check (code = lower(btrim(code)) and length(btrim(code)) between 2 and 80),
  name text not null check (length(btrim(name)) between 2 and 120),
  description text not null default '',
  department_id bigint,
  icon text not null default 'bot' check (length(btrim(icon)) between 1 and 40),
  model_code text not null default '',
  prompt_version text not null default 'v1' check (length(btrim(prompt_version)) between 1 and 40),
  system_prompt_summary text not null default '',
  capabilities text[] not null default '{}'::text[],
  input_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(input_schema) = 'object'),
  tool_scope jsonb not null default '{}'::jsonb check (jsonb_typeof(tool_scope) = 'object'),
  visibility_scope text not null default 'all' check (visibility_scope in ('all', 'dept', 'list', 'role')),
  min_job_level smallint not null default 1 check (min_job_level between 1 and 20),
  status text not null default 'enabled' check (status in ('enabled', 'disabled', 'archived')),
  created_by_member_id bigint,
  updated_by_member_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, organization_id, id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id)
    references public.departments (tenant_id, id) on delete restrict,
  foreign key (organization_id, created_by_member_id)
    references public.organization_members (organization_id, id) on delete set null,
  foreign key (organization_id, updated_by_member_id)
    references public.organization_members (organization_id, id) on delete set null,
  check (cardinality(capabilities) <= 20)
);

create unique index agent_definitions_organization_code_uidx
  on public.agent_definitions (organization_id, code)
  where deleted_at is null;

create index agent_definitions_org_status_idx
  on public.agent_definitions (organization_id, status, updated_at desc)
  where deleted_at is null;

create table public.agent_permissions (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  agent_id bigint not null,
  scope_type text not null check (scope_type in ('all', 'dept', 'role', 'member')),
  department_id bigint,
  role_code text,
  member_id bigint,
  min_job_level smallint not null default 1 check (min_job_level between 1 and 20),
  created_by_member_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id, agent_id)
    references public.agent_definitions (tenant_id, organization_id, id) on delete cascade,
  foreign key (tenant_id, department_id)
    references public.departments (tenant_id, id) on delete restrict,
  foreign key (organization_id, member_id)
    references public.organization_members (organization_id, id) on delete cascade,
  foreign key (organization_id, created_by_member_id)
    references public.organization_members (organization_id, id) on delete set null,
  check (
    (scope_type = 'all' and department_id is null and role_code is null and member_id is null)
    or (scope_type = 'dept' and department_id is not null and role_code is null and member_id is null)
    or (scope_type = 'role' and department_id is null and role_code is not null and member_id is null)
    or (scope_type = 'member' and department_id is null and role_code is null and member_id is not null)
  )
);

create unique index agent_permissions_scope_uidx
  on public.agent_permissions (
    agent_id,
    scope_type,
    coalesce(department_id, 0),
    coalesce(member_id, 0),
    coalesce(role_code, '')
  )
  where deleted_at is null;

create index agent_permissions_agent_idx
  on public.agent_permissions (organization_id, agent_id, scope_type)
  where deleted_at is null;

create table public.agent_invocations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  agent_id bigint not null,
  actor_member_id bigint not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  input_summary text not null default '',
  output_summary text not null default '',
  model_code text not null default '',
  prompt_version text not null default '',
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_amount numeric(14,6) not null default 0 check (cost_amount >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, organization_id, id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id, agent_id)
    references public.agent_definitions (tenant_id, organization_id, id) on delete restrict,
  foreign key (organization_id, actor_member_id)
    references public.organization_members (organization_id, id) on delete restrict,
  check (completed_at is null or completed_at >= started_at)
);

create index agent_invocations_agent_started_idx
  on public.agent_invocations (organization_id, agent_id, started_at desc);

create index agent_invocations_actor_started_idx
  on public.agent_invocations (organization_id, actor_member_id, started_at desc);

create table public.agent_execution_logs (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  invocation_id bigint not null,
  log_level text not null default 'info' check (log_level in ('debug', 'info', 'warn', 'error')),
  event_type text not null check (length(btrim(event_type)) between 1 and 80),
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id, invocation_id)
    references public.agent_invocations (tenant_id, organization_id, id) on delete cascade
);

create index agent_execution_logs_invocation_idx
  on public.agent_execution_logs (invocation_id, created_at);

alter table public.agent_definitions enable row level security;
alter table public.agent_definitions force row level security;
alter table public.agent_permissions enable row level security;
alter table public.agent_permissions force row level security;
alter table public.agent_invocations enable row level security;
alter table public.agent_invocations force row level security;
alter table public.agent_execution_logs enable row level security;
alter table public.agent_execution_logs force row level security;

create policy agent_definitions_member_select on public.agent_definitions
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and status in ('enabled', 'disabled')
    and (select public.is_organization_member(organization_id))
  );

create policy agent_definitions_admin_insert on public.agent_definitions
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin']))
  );

create policy agent_definitions_admin_update on public.agent_definitions
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.has_organization_role(organization_id, array['owner', 'admin']))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin']))
  );

create policy agent_permissions_member_select on public.agent_permissions
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.is_organization_member(organization_id))
  );

create policy agent_permissions_admin_insert on public.agent_permissions
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin']))
  );

create policy agent_permissions_admin_update on public.agent_permissions
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and deleted_at is null
    and (select public.has_organization_role(organization_id, array['owner', 'admin']))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_role(organization_id, array['owner', 'admin']))
  );

create policy agent_invocations_member_select on public.agent_invocations
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.has_organization_role(organization_id, array['owner', 'admin']))
      or exists (
        select 1
        from public.organization_members member
        where member.tenant_id = agent_invocations.tenant_id
          and member.organization_id = agent_invocations.organization_id
          and member.id = agent_invocations.actor_member_id
          and member.user_id = (select auth.uid())
          and member.status = 'active'
      )
    )
  );

create policy agent_invocations_member_insert on public.agent_invocations
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.organization_members member
      where member.tenant_id = agent_invocations.tenant_id
        and member.organization_id = agent_invocations.organization_id
        and member.id = agent_invocations.actor_member_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
    )
  );

create policy agent_invocations_system_update on public.agent_invocations
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.has_organization_role(organization_id, array['owner', 'admin']))
      or exists (
        select 1
        from public.organization_members member
        where member.tenant_id = agent_invocations.tenant_id
          and member.organization_id = agent_invocations.organization_id
          and member.id = agent_invocations.actor_member_id
          and member.user_id = (select auth.uid())
          and member.status = 'active'
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
  );

create policy agent_execution_logs_member_select on public.agent_execution_logs
  for select to authenticated
  using (
    exists (
      select 1
      from public.agent_invocations invocation
      where invocation.tenant_id = agent_execution_logs.tenant_id
        and invocation.organization_id = agent_execution_logs.organization_id
        and invocation.id = agent_execution_logs.invocation_id
        and invocation.tenant_id = (select public.current_tenant_id())
        and (
          (select public.has_organization_role(invocation.organization_id, array['owner', 'admin']))
          or exists (
            select 1
            from public.organization_members member
            where member.tenant_id = invocation.tenant_id
              and member.organization_id = invocation.organization_id
              and member.id = invocation.actor_member_id
              and member.user_id = (select auth.uid())
              and member.status = 'active'
          )
        )
    )
  );

create policy agent_execution_logs_member_insert on public.agent_execution_logs
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.is_organization_member(organization_id))
  );

grant select, insert, update on public.agent_definitions,
  public.agent_permissions,
  public.agent_invocations
  to authenticated;
grant select, insert on public.agent_execution_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

with seed(code, name, department_name, icon, description, capabilities, visibility_scope, min_job_level) as (
  values
    ('task_breakdown', '任务拆解 Agent', '产品中心', 'check', '把项目目标拆成可执行任务、验收标准和依赖顺序。', array['目标拆解','验收标准','依赖识别'], 'all', 1),
    ('smart_dispatch', '智能派单 Agent', '管理层', 'flow', '根据员工画像、职能、职级、负载、历史质量和效率给出默认推荐，并允许负责人人工改派。', array['默认推荐','差异提示','改派记录'], 'all', 1),
    ('feishu_notify', '飞书通知 Agent', '行政部', 'bot', '把确认下发的任务、审批和提醒同步到飞书，并记录发送结果。', array['任务通知','审批提醒','回执记录'], 'all', 1),
    ('employee_profile', '员工画像 Agent', '人力资源', 'user', '沉淀员工技能、偏好、历史质量、效率和成长方向。', array['技能画像','能力证据','成长建议'], 'list', 3),
    ('salary_calculation', '薪资核算 Agent', '财务部', 'money', '按部门职级薪资带、绩效、项目奖金池和扣款规则生成薪资建议。', array['职级工资','绩效奖金','项目奖金池'], 'list', 4),
    ('expense_review', '报账审核 Agent', '财务部', 'file', '检查报账金额、项目归属、附件完整性和费用合规风险。', array['附件检查','预算归属','风险提示'], 'list', 3),
    ('knowledge_qa', '知识库问答 Agent', '数据中心', 'book', '基于企业知识库做权限内检索、引用和答案生成。', array['知识检索','引用追踪','权限过滤'], 'all', 1),
    ('project_review', '项目复盘 Agent', '管理层', 'target', '汇总项目进度、风险、质量、复盘结论和下一步改进动作。', array['项目复盘','风险总结','改进动作'], 'all', 2)
)
insert into public.agent_definitions (
  tenant_id,
  organization_id,
  code,
  name,
  department_id,
  icon,
  description,
  capabilities,
  visibility_scope,
  min_job_level,
  system_prompt_summary,
  prompt_version,
  status
)
select
  organization.tenant_id,
  organization.id,
  seed.code,
  seed.name,
  department.id,
  seed.icon,
  seed.description,
  seed.capabilities,
  seed.visibility_scope,
  seed.min_job_level,
  '企业内部 Agent，由权限和职级统一管理。',
  'v1',
  'enabled'
from public.organizations organization
join seed on true
left join public.departments department
  on department.tenant_id = organization.tenant_id
 and department.organization_id = organization.id
 and department.name = seed.department_name
 and department.deleted_at is null
on conflict (organization_id, code) where deleted_at is null do update
set name = excluded.name,
    department_id = excluded.department_id,
    icon = excluded.icon,
    description = excluded.description,
    capabilities = excluded.capabilities,
    visibility_scope = excluded.visibility_scope,
    min_job_level = excluded.min_job_level,
    system_prompt_summary = excluded.system_prompt_summary,
    prompt_version = excluded.prompt_version,
    status = 'enabled',
    updated_at = now();

with agent_scope as (
  select agent.tenant_id, agent.organization_id, agent.id as agent_id, agent.visibility_scope, agent.min_job_level
  from public.agent_definitions agent
  where agent.code in (
    'task_breakdown',
    'smart_dispatch',
    'feishu_notify',
    'employee_profile',
    'salary_calculation',
    'expense_review',
    'knowledge_qa',
    'project_review'
  )
    and agent.deleted_at is null
)
insert into public.agent_permissions (
  tenant_id,
  organization_id,
  agent_id,
  scope_type,
  min_job_level
)
select
  agent_scope.tenant_id,
  agent_scope.organization_id,
  agent_scope.agent_id,
  'all' as scope_type,
  agent_scope.min_job_level
from agent_scope
on conflict do nothing;

comment on table public.agent_definitions is
  'Enterprise Agent Center directory. Agents are internal capabilities controlled by roles and job levels.';
comment on table public.agent_permissions is
  'Agent access rules by organization, department, role, member and minimum job level.';
comment on table public.agent_invocations is
  'Agent invocation ledger with actor, status, cost, timing and output summary.';
comment on table public.agent_execution_logs is
  'Append-only execution events for each agent invocation.';
