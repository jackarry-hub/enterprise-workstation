# Feishu Task Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在正式工作站创建并指派任务后，使用企业工作站机器人通知对应飞书员工，并通过安全深链返回工作站领取任务。

**Architecture:** 现有 Supabase 新增租户隔离的 `task_notifications` 投递队列，由数据库触发器在任务创建时写入唯一待发送记录。Next.js 服务端使用 Service Role 读取最小投递上下文、调用飞书机器人消息 API 并回写稳定状态；正式 HTML 工作站只接收安全状态和任务 UUID，继续复用现有登录、权限与领取接口。

**Tech Stack:** Next.js 15、TypeScript、Vitest、Supabase/PostgreSQL、飞书 OpenAPI、独立 HTML/ES5 JavaScript、Node.js test runner。

**Spec:** `docs/superpowers/specs/2026-08-20-feishu-task-notification-design.md`

## Global Constraints

- 采用“飞书通知跳转工作台后领取”，不实现飞书卡片回调领取。
- 正式链接固定由 `NEXT_PUBLIC_APP_URL` 生成，不写死 `localhost`、服务器 IP 或端口。
- 继续使用现有 Supabase，不引入第二套数据库。
- `FEISHU_APP_SECRET`、`SUPABASE_SERVICE_ROLE_KEY`、`tenant_access_token` 和员工 `open_id` 只允许在服务端使用。
- 飞书故障不能回滚已经创建的任务；任务创建接口仍返回 HTTP `201`。
- 只有具备 `task.manage` 权限的用户可以重发失败通知。
- 飞书消息只携带任务公开 UUID，不携带登录令牌、内部数值 ID、工资或其他私密数据。
- 本地自动化测试使用模拟飞书响应，不向真实员工发送消息。
- 当前飞书后台的机器人能力与 `im:message:send_as_bot` 权限保持未发布，代码端到端验证完成后再发布新版本。

---

## File Map

- Create: `supabase/migrations/202608200001_feishu_task_notifications.sql` — 通知队列、唯一约束、触发器、RLS 和服务端投递上下文函数。
- Create: `src/features/workstation/task-notification-migration.test.ts` — 数据库契约测试。
- Create: `src/features/feishu/task-notification.ts` — 环境校验、任务深链、飞书卡片与 OpenAPI 调用。
- Create: `src/features/feishu/task-notification.test.ts` — 飞书客户端单元测试与脱敏测试。
- Create: `src/features/workstation/task-notification.ts` — Service Role 上下文读取、状态回写与投递编排。
- Create: `src/features/workstation/task-notification.test.ts` — 投递状态机测试。
- Modify: `src/app/api/workstation/tasks/handler.ts` — 任务提交后调用通知编排器并返回双状态。
- Modify: `src/app/api/workstation/tasks/handler.test.ts` — 创建成功、通知失败、无身份场景测试。
- Create: `src/app/api/workstation/tasks/[taskId]/notify/handler.ts` — 管理权限保护的重试接口。
- Create: `src/app/api/workstation/tasks/[taskId]/notify/handler.test.ts` — 重试接口权限和安全响应测试。
- Create: `src/app/api/workstation/tasks/[taskId]/notify/route.ts` — `POST` 路由绑定。
- Modify: `src/app/api/workstation/bootstrap/handler.ts` — 加载可见任务的通知状态。
- Modify: `src/app/api/workstation/bootstrap/handler.test.ts` — Bootstrap 通知状态映射测试。
- Modify: `src/features/workstation/server-bootstrap.ts` — 输出 `notification` 安全字段。
- Modify: `src/features/workstation/server-bootstrap.test.ts` — 公开任务形状测试。
- Modify: `public/workstation-server-adapter.js` — 创建结果双状态与通知重试调用。
- Modify: `tests/html-workstation-server-adapter.test.mjs` — 适配器请求契约测试。
- Modify: `quantxy-ai-workbench-fused.html` — 深链、投递提示、管理员重发按钮。
- Modify: `public/quantxy-ai-workbench-fused.html` — 与根目录工作站保持相同正式行为。
- Modify: `tests/html-personal-workbench-behavior.test.mjs` — 合法/非法深链、无权任务、通知提示和重试行为测试。
- Modify: `tests/html-fusion-contract.test.mjs` — 两份 HTML 正式行为契约。
- Modify: `.env.example` — 说明飞书通知所需变量及部署域名要求。
- Modify: `docs/deployment/phase1-supabase-feishu.md` — 增加机器人权限、应用发布与服务器变量核对步骤。

---

### Task 1: Add the tenant-isolated notification queue

**Files:**
- Create: `supabase/migrations/202608200001_feishu_task_notifications.sql`
- Create: `src/features/workstation/task-notification-migration.test.ts`

**Interfaces:**
- Consumes: `public.tasks`, `public.organizations`, `public.organization_members`, `public.external_identities`, `public.identity_providers`.
- Produces: `public.task_notifications`, trigger `queue_task_assigned_notification`, RPCs `get_task_notification_delivery_context(uuid, uuid, uuid)` and `record_task_notification_delivery(uuid, uuid, uuid, text, text, text)`.

- [ ] **Step 1: Write the failing migration contract**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608200001_feishu_task_notifications.sql",
  "utf8",
);

describe("Feishu task notification migration", () => {
  it("creates a tenant-scoped idempotent delivery queue", () => {
    expect(sql).toMatch(/create table public\.task_notifications/i);
    expect(sql).toMatch(/tenant_id bigint not null/i);
    expect(sql).toMatch(/unique \(tenant_id, task_id, recipient_member_id, event_type\)/i);
    expect(sql).toMatch(/status in \('pending', 'sent', 'failed'\)/i);
  });

  it("queues assignments and exposes context only to service_role", () => {
    expect(sql).toMatch(/create trigger queue_task_assigned_notification/i);
    expect(sql).toMatch(/create or replace function public\.get_task_notification_delivery_context/i);
    expect(sql).toMatch(/create or replace function public\.record_task_notification_delivery/i);
    expect(sql).toMatch(/revoke all on function public\.get_task_notification_delivery_context[\s\S]*authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.get_task_notification_delivery_context[\s\S]*service_role/i);
  });
});
```

- [ ] **Step 2: Run the migration contract and verify RED**

Run: `npm run test:unit -- src/features/workstation/task-notification-migration.test.ts`

Expected: FAIL because `202608200001_feishu_task_notifications.sql` does not exist.

- [ ] **Step 3: Create the migration**

Create a queue with `public_id`, tenant/organization/task/member foreign keys, `event_type = 'task.assigned'`, `pending|sent|failed`, `attempt_count`, `feishu_message_id`, `last_error_code`, and timestamps. Add:

```sql
create table public.task_notifications (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  task_id bigint not null,
  recipient_member_id bigint not null,
  event_type text not null default 'task.assigned'
    check (event_type = 'task.assigned'),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  feishu_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  foreign key (organization_id, task_id)
    references public.tasks (organization_id, id) on delete cascade,
  foreign key (organization_id, recipient_member_id)
    references public.organization_members (organization_id, id) on delete cascade
);

create unique index task_notifications_delivery_once_idx
  on public.task_notifications (tenant_id, task_id, recipient_member_id, event_type);

create or replace function public.enqueue_task_assigned_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
begin
  if new.assignee_member_id is null then return new; end if;
  select organization.tenant_id into strict v_tenant_id
  from public.organizations organization
  where organization.id = new.organization_id;

  insert into public.task_notifications (
    tenant_id, organization_id, task_id, recipient_member_id, event_type, status
  ) values (
    v_tenant_id, new.organization_id, new.id,
    new.assignee_member_id, 'task.assigned', 'pending'
  ) on conflict (tenant_id, task_id, recipient_member_id, event_type) do nothing;
  return new;
end;
$$;

create trigger queue_task_assigned_notification
after insert on public.tasks
for each row execute function public.enqueue_task_assigned_notification();
```

The service-role-only context RPC must require all three public scope values and return one row containing `notification_public_id`, `task_public_id`, `recipient_open_id`, `task_title`, `project_name`, `reporter_name`, `priority`, `due_date`, `acceptance_criteria`, `status`, and `attempt_count`. Resolve `recipient_open_id` only from an active Feishu provider identity whose `provider_subject` starts with `open_id:`; return `NULL` when no valid identity exists:

```sql
create or replace function public.get_task_notification_delivery_context(
  p_tenant_public_id uuid,
  p_organization_public_id uuid,
  p_task_public_id uuid
)
returns table (
  notification_public_id uuid,
  task_public_id uuid,
  recipient_open_id text,
  task_title text,
  project_name text,
  reporter_name text,
  priority text,
  due_date date,
  acceptance_criteria text,
  status text,
  attempt_count integer
)
language sql
security definer
set search_path = ''
as $$
  select notification.public_id,
         task.public_id,
         case when identity.provider_subject like 'open_id:%'
           then substring(identity.provider_subject from 9) end,
         task.title,
         project.name,
         reporter.display_name,
         task.priority,
         task.due_date,
         task.acceptance_criteria,
         notification.status,
         notification.attempt_count
  from public.tenants tenant
  join public.organizations organization
    on organization.tenant_id = tenant.id
  join public.tasks task
    on task.organization_id = organization.id
   and task.public_id = p_task_public_id
   and task.deleted_at is null
  join public.task_notifications notification
    on notification.tenant_id = tenant.id
   and notification.organization_id = organization.id
   and notification.task_id = task.id
   and notification.recipient_member_id = task.assignee_member_id
   and notification.event_type = 'task.assigned'
  join public.projects project on project.id = task.project_id
  join public.employee_profiles reporter
    on reporter.organization_member_id = task.reporter_member_id
   and reporter.deleted_at is null
  left join public.identity_providers provider
    on provider.tenant_id = tenant.id
   and provider.provider_code = 'feishu'
   and provider.status = 'active'
  left join public.external_identities identity
    on identity.tenant_id = tenant.id
   and identity.organization_id = organization.id
   and identity.organization_member_id = task.assignee_member_id
   and identity.identity_provider_id = provider.id
   and identity.status in ('invited', 'active')
  where tenant.public_id = p_tenant_public_id
    and organization.public_id = p_organization_public_id
  limit 1;
$$;
```

Record results atomically and increment every handled delivery attempt:

```sql
create or replace function public.record_task_notification_delivery(
  p_tenant_public_id uuid,
  p_organization_public_id uuid,
  p_notification_public_id uuid,
  p_status text,
  p_feishu_message_id text,
  p_last_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'Notification status is invalid' using errcode = '22023';
  end if;

  update public.task_notifications notification
  set status = p_status,
      attempt_count = notification.attempt_count + 1,
      feishu_message_id = case when p_status = 'sent' then p_feishu_message_id else null end,
      last_error_code = case when p_status = 'failed' then p_last_error_code else null end,
      last_attempt_at = now(),
      sent_at = case when p_status = 'sent' then now() else notification.sent_at end
  from public.tenants tenant, public.organizations organization
  where notification.public_id = p_notification_public_id
    and notification.tenant_id = tenant.id
    and notification.organization_id = organization.id
    and tenant.public_id = p_tenant_public_id
    and organization.public_id = p_organization_public_id;

  if not found then
    raise exception 'Notification does not exist' using errcode = 'P0002';
  end if;
end;
$$;
```

Enable RLS. Add authenticated `SELECT` only when the current user can view the underlying task project; do not add authenticated insert/update/delete policies. Revoke both RPCs from browser roles and grant only to `service_role`:

```sql
alter table public.task_notifications enable row level security;

create policy task_notifications_authorized_select
on public.task_notifications
for select to authenticated
using (
  exists (
    select 1 from public.tasks task
    where task.id = task_notifications.task_id
      and task.organization_id = task_notifications.organization_id
      and task.deleted_at is null
      and (select public.can_view_project(task.project_id))
  )
);

revoke all on function public.get_task_notification_delivery_context(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.get_task_notification_delivery_context(uuid,uuid,uuid)
  to service_role;
revoke all on function public.record_task_notification_delivery(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_task_notification_delivery(uuid,uuid,uuid,text,text,text)
  to service_role;
```

- [ ] **Step 4: Run the migration contract and project migration checks**

Run: `npm run test:unit -- src/features/workstation/task-notification-migration.test.ts src/features/workstation/task-acceptance-migration.test.ts`

Expected: PASS with no migration contract failures.

- [ ] **Step 5: Commit the queue migration**

```powershell
git add -- supabase/migrations/202608200001_feishu_task_notifications.sql src/features/workstation/task-notification-migration.test.ts
git commit -m "feat: add Feishu task notification queue"
```

---

### Task 2: Build the server-only Feishu message client

**Files:**
- Create: `src/features/feishu/task-notification.ts`
- Create: `src/features/feishu/task-notification.test.ts`

**Interfaces:**
- Produces: `getFeishuTaskNotificationEnv()`, `buildTaskNotificationLink()`, `sendFeishuTaskNotification()`.
- `sendFeishuTaskNotification(input, env, fetchImpl)` returns `{ messageId: string }` or throws only `token_unavailable`, `send_failed`, or `configuration_unavailable`.

- [ ] **Step 1: Write failing environment, link, card and redaction tests**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildTaskNotificationLink,
  getFeishuTaskNotificationEnv,
  sendFeishuTaskNotification,
} from "@/features/feishu/task-notification";

const taskId = "11111111-1111-4111-8111-111111111111";

it("builds a deployable task link without identities or tokens", () => {
  expect(buildTaskNotificationLink("https://brain.example", taskId)).toBe(
    `https://brain.example/quantxy-ai-workbench-fused.html?formal=1&task=${taskId}`,
  );
});

it("rejects missing secrets and credential-bearing app URLs", () => {
  expect(() => getFeishuTaskNotificationEnv({})).toThrow("configuration_unavailable");
  expect(() => getFeishuTaskNotificationEnv({
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    NEXT_PUBLIC_APP_URL: "https://user:pass@brain.example",
  })).toThrow("configuration_unavailable");
});

it("sends an application card to one open_id", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(Response.json({ code: 0, tenant_access_token: "tenant-token" }))
    .mockResolvedValueOnce(Response.json({ code: 0, data: { message_id: "om_123" } }));

  await expect(sendFeishuTaskNotification({
    taskId,
    recipientOpenId: "ou_employee",
    taskTitle: "完成联调",
    projectName: "企业工作站",
    reporterName: "负责人",
    priority: "high",
    dueDate: "2026-08-25",
    acceptanceCriteria: "负责人验收通过",
  }, {
    appId: "cli_test",
    appSecret: "app-secret",
    appUrl: "https://brain.example",
  }, fetchImpl)).resolves.toEqual({ messageId: "om_123" });

  const request = JSON.stringify(fetchImpl.mock.calls[1]);
  expect(request).toContain("ou_employee");
  expect(request).toContain("查看并领取");
  expect(request).not.toContain("app-secret");
  expect(request).not.toContain("tenant-token");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:unit -- src/features/feishu/task-notification.test.ts`

Expected: FAIL because the notification client module does not exist.

- [ ] **Step 3: Implement strict environment and deep-link validation**

Use these exact public types:

```ts
export type FeishuTaskNotificationEnv = {
  appId: string;
  appSecret: string;
  appUrl: string;
};

export type FeishuTaskNotificationInput = {
  taskId: string;
  recipientOpenId: string;
  taskTitle: string;
  projectName: string;
  reporterName: string;
  priority: string;
  dueDate: string;
  acceptanceCriteria: string;
};
```

Accept only root `http:` or `https:` URLs without username, password, query, or hash. `buildTaskNotificationLink()` must validate the task UUID and use `URL.searchParams`, not string concatenation of untrusted values.

- [ ] **Step 4: Implement token exchange and card delivery**

POST the credentials to `/open-apis/auth/v3/tenant_access_token/internal`, then POST to `/open-apis/im/v1/messages?receive_id_type=open_id` with:

```ts
{
  receive_id: input.recipientOpenId,
  msg_type: "interactive",
  content: JSON.stringify({
    config: { wide_screen_mode: true },
    header: { template: "blue", title: { tag: "plain_text", content: "你有一项新任务" } },
    elements: [
      { tag: "markdown", content: messageSummary },
      { tag: "action", actions: [{
        tag: "button",
        type: "primary",
        text: { tag: "plain_text", content: "查看并领取" },
        url: buildTaskNotificationLink(env.appUrl, input.taskId),
      }] },
    ],
  }),
}
```

Use an 8-second abort timeout for each external request. Parse unknown JSON defensively. Never include provider response bodies in thrown errors.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm run test:unit -- src/features/feishu/task-notification.test.ts`

Expected: PASS for link generation, environment validation, success, token failure, send failure, timeout and secret-redaction cases.

- [ ] **Step 6: Commit the Feishu client**

```powershell
git add -- src/features/feishu/task-notification.ts src/features/feishu/task-notification.test.ts
git commit -m "feat: send Feishu task notification cards"
```

---

### Task 3: Orchestrate delivery and stable queue state

**Files:**
- Create: `src/features/workstation/task-notification.ts`
- Create: `src/features/workstation/task-notification.test.ts`

**Interfaces:**
- Consumes: `get_task_notification_delivery_context`, `sendFeishuTaskNotification`.
- Produces: `dispatchTaskAssignedNotification(scope)` with `scope = { tenantId: string; organizationId: string; taskId: string }`.
- Returns: `{ status: "sent" | "failed" | "unavailable"; errorCode?: "token_unavailable" | "recipient_unavailable" | "send_failed" | "configuration_unavailable" }`.

- [ ] **Step 1: Write failing state-machine tests**

Test these exact outcomes with injected `loadContext`, `sendMessage`, and `recordResult` dependencies:

```ts
it.each([
  [null, { status: "unavailable", errorCode: "recipient_unavailable" }],
  [{ recipientOpenId: null }, { status: "unavailable", errorCode: "recipient_unavailable" }],
])("does not call Feishu without a recipient identity", async (context, expected) => {
  const sendMessage = vi.fn();
  const dispatch = createTaskNotificationDispatcher({
    loadContext: vi.fn().mockResolvedValue(context),
    sendMessage,
    recordResult: vi.fn(),
  });
  await expect(dispatch(scope)).resolves.toEqual(expected);
  expect(sendMessage).not.toHaveBeenCalled();
});

it("does not resend a notification already marked sent", async () => {
  const sendMessage = vi.fn();
  const dispatch = createTaskNotificationDispatcher({
    loadContext: vi.fn().mockResolvedValue({ ...context, status: "sent" }),
    sendMessage,
    recordResult: vi.fn(),
  });
  await expect(dispatch(scope)).resolves.toEqual({ status: "sent" });
  expect(sendMessage).not.toHaveBeenCalled();
});
```

Also cover a successful send recording `messageId`, and mapped failures recording only a stable code.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:unit -- src/features/workstation/task-notification.test.ts`

Expected: FAIL because the dispatcher module does not exist.

- [ ] **Step 3: Implement the dependency-injected dispatcher**

`createTaskNotificationDispatcher()` must:

1. Load one scoped queue/context row.
2. Return `unavailable` and record `recipient_unavailable` when no Feishu `open_id` exists.
3. Return `sent` without an external request when queue state is already `sent`.
4. Increment `attempt_count` for every real attempt.
5. Record only `messageId` on success or the stable error code on failure.
6. Log only task public ID, notification public ID, attempt count and stable code.

Define the neighboring interfaces and stable mapping in the same file:

```ts
export type TaskNotificationScope = {
  tenantId: string;
  organizationId: string;
  taskId: string;
};

export type TaskNotificationErrorCode =
  | "token_unavailable"
  | "recipient_unavailable"
  | "send_failed"
  | "configuration_unavailable";

type TaskNotificationContext = FeishuTaskNotificationInput & {
  notificationId: string;
  recipientOpenId: string | null;
  status: "pending" | "sent" | "failed";
  attemptCount: number;
};

type TaskNotificationDependencies = {
  loadContext: (scope: TaskNotificationScope) => Promise<TaskNotificationContext | null>;
  sendMessage: (input: FeishuTaskNotificationInput) => Promise<{ messageId: string }>;
  recordResult: (
    scope: TaskNotificationScope,
    notificationId: string,
    result: { status: "sent"; messageId: string }
      | { status: "failed"; errorCode: TaskNotificationErrorCode },
  ) => Promise<void>;
};

function stableNotificationError(error: unknown): TaskNotificationErrorCode {
  const code = error instanceof Error ? error.message : "";
  return code === "token_unavailable"
    || code === "configuration_unavailable"
    || code === "recipient_unavailable"
    ? code
    : "send_failed";
}
```

Use this control flow:

```ts
export function createTaskNotificationDispatcher(
  dependencies: TaskNotificationDependencies,
) {
  return async function dispatch(scope: TaskNotificationScope) {
    const context = await dependencies.loadContext(scope);
    if (!context || !context.recipientOpenId) {
      if (context) {
        await dependencies.recordResult(scope, context.notificationId, {
          status: "failed",
          errorCode: "recipient_unavailable",
        });
      }
      return { status: "unavailable", errorCode: "recipient_unavailable" } as const;
    }
    if (context.status === "sent") return { status: "sent" } as const;

    try {
      const result = await dependencies.sendMessage(context);
      await dependencies.recordResult(scope, context.notificationId, {
        status: "sent",
        messageId: result.messageId,
      });
      return { status: "sent" } as const;
    } catch (error) {
      const errorCode = stableNotificationError(error);
      await dependencies.recordResult(scope, context.notificationId, {
        status: "failed",
        errorCode,
      });
      return { status: "failed", errorCode } as const;
    }
  };
}
```

- [ ] **Step 4: Implement the default Service Role dependencies**

Create an admin Supabase client with `persistSession: false` and `autoRefreshToken: false`. Call the service-role-only context RPC with all public scope values; call `record_task_notification_delivery` with the notification public ID plus the same tenant and organization scope. Do not return the context row, `open_id`, token or raw provider error to callers.

```ts
const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await admin.rpc(
  "get_task_notification_delivery_context",
  {
    p_tenant_public_id: scope.tenantId,
    p_organization_public_id: scope.organizationId,
    p_task_public_id: scope.taskId,
  },
);
if (error) throw new Error("notification_context_unavailable");

await admin.rpc("record_task_notification_delivery", {
  p_tenant_public_id: scope.tenantId,
  p_organization_public_id: scope.organizationId,
  p_notification_public_id: notificationId,
  p_status: result.status,
  p_feishu_message_id: result.status === "sent" ? result.messageId : null,
  p_last_error_code: result.status === "failed" ? result.errorCode : null,
});
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm run test:unit -- src/features/workstation/task-notification.test.ts`

Expected: PASS for sent, failed, unavailable, already-sent and redaction cases.

- [ ] **Step 6: Commit the dispatcher**

```powershell
git add -- src/features/workstation/task-notification.ts src/features/workstation/task-notification.test.ts
git commit -m "feat: orchestrate task notification delivery"
```

---

### Task 4: Return task and notification status independently

**Files:**
- Modify: `src/app/api/workstation/tasks/handler.ts`
- Modify: `src/app/api/workstation/tasks/handler.test.ts`

**Interfaces:**
- `TaskCreateSession` adds `tenantId` and `organization.id`.
- `WorkstationTaskCreateDependencies` adds `notifyTask(scope)`.
- HTTP `201` body becomes `{ task, notification }`.

- [ ] **Step 1: Add failing handler tests**

Add assertions for:

```ts
it("keeps HTTP 201 when Feishu delivery fails", async () => {
  const handler = createWorkstationTaskCreateHandler({
    loadSession: async () => managerSession,
    createTask: vi.fn().mockResolvedValue({ id: taskId, st: "待处理" }),
    notifyTask: vi.fn().mockResolvedValue({ status: "failed", errorCode: "send_failed" }),
  });
  const response = await handler(taskCreateRequest());
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toEqual({
    task: { id: taskId, st: "待处理" },
    notification: { status: "failed", errorCode: "send_failed" },
  });
});
```

Also assert that an unexpected notifier exception is normalized to `{ status: "failed", errorCode: "send_failed" }` and never changes task creation status.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:unit -- src/app/api/workstation/tasks/handler.test.ts`

Expected: FAIL because `notifyTask` is not part of the dependency contract and the response has no notification state.

- [ ] **Step 3: Implement post-commit notification delivery**

Call `createTask` first. Only after it resolves, call:

```ts
await dependencies.notifyTask({
  tenantId: session.tenantId,
  organizationId: session.organization.id,
  taskId: String((task as { id: unknown }).id),
});
```

Normalize all notifier exceptions to `send_failed`, then return `NextResponse.json({ task, notification }, { status: 201 })`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm run test:unit -- src/app/api/workstation/tasks/handler.test.ts`

Expected: PASS; existing validation and permission tests remain green.

- [ ] **Step 5: Commit task-create integration**

```powershell
git add -- src/app/api/workstation/tasks/handler.ts src/app/api/workstation/tasks/handler.test.ts
git commit -m "feat: notify assignees after task creation"
```

---

### Task 5: Add manager-only notification retry

**Files:**
- Create: `src/app/api/workstation/tasks/[taskId]/notify/handler.ts`
- Create: `src/app/api/workstation/tasks/[taskId]/notify/handler.test.ts`
- Create: `src/app/api/workstation/tasks/[taskId]/notify/route.ts`

**Interfaces:**
- Produces: `POST /api/workstation/tasks/:taskId/notify`.
- Returns: `{ notification }`; never returns `open_id`, access tokens or raw provider errors.

- [ ] **Step 1: Write failing route-handler tests**

Cover `401` without session, `403` without `task.manage`, `400` for non-UUID task ID, `200` for scoped retry, and normalized `502` failure. The success assertion must be:

```ts
expect(notifyTask).toHaveBeenCalledWith({
  tenantId: managerSession.tenantId,
  organizationId: managerSession.organization.id,
  taskId,
});
expect(await response.json()).toEqual({ notification: { status: "sent" } });
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:unit -- src/app/api/workstation/tasks/[taskId]/notify/handler.test.ts`

Expected: FAIL because the retry handler does not exist.

- [ ] **Step 3: Implement permission and scope checks**

Reuse the UUID rule from the task mutation route. Require `session.permissionCodes.includes("task.manage")`; pass only session tenant, session organization and route task UUID into the dispatcher.

```ts
export function createWorkstationTaskNotifyHandler(
  dependencies: WorkstationTaskNotifyDependencies,
) {
  return async function notify(
    _request: Request,
    context: { params: Promise<{ taskId: string }> },
  ) {
    const session = await dependencies.loadSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (!session.permissionCodes.includes("task.manage")) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const { taskId } = await context.params;
    if (!UUID_PATTERN.test(taskId)) {
      return Response.json({ error: "invalid_task" }, { status: 400 });
    }
    try {
      const notification = await dependencies.notifyTask({
        tenantId: session.tenantId,
        organizationId: session.organization.id,
        taskId,
      });
      return Response.json({ notification }, {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return Response.json({ error: "notification_retry_failed" }, {
        status: 502,
        headers: { "cache-control": "no-store" },
      });
    }
  };
}
```

- [ ] **Step 4: Bind the POST route and run tests**

Run: `npm run test:unit -- src/app/api/workstation/tasks/[taskId]/notify/handler.test.ts`

Expected: PASS with secret-free response snapshots.

- [ ] **Step 5: Commit the retry endpoint**

```powershell
git add -- 'src/app/api/workstation/tasks/[taskId]/notify'
git commit -m "feat: retry failed Feishu task notifications"
```

---

### Task 6: Expose safe notification status through Bootstrap and the adapter

**Files:**
- Modify: `src/app/api/workstation/bootstrap/handler.ts`
- Modify: `src/app/api/workstation/bootstrap/handler.test.ts`
- Modify: `src/features/workstation/server-bootstrap.ts`
- Modify: `src/features/workstation/server-bootstrap.test.ts`
- Modify: `public/workstation-server-adapter.js`
- Modify: `tests/html-workstation-server-adapter.test.mjs`

**Interfaces:**
- Public task field: `notification: { status: "pending" | "sent" | "failed" | "unavailable"; errorCode: string }`.
- Adapter adds `retryTaskNotification(taskId)`.
- Adapter `createTask(input)` continues returning the task object, enriched with `task.notification`.

- [ ] **Step 1: Add failing Bootstrap mapping tests**

Add notification rows to the server-bootstrap fixture and assert:

```ts
expect(bootstrap.tasks[0].notification).toEqual({
  status: "failed",
  errorCode: "send_failed",
});
expect(JSON.stringify(bootstrap)).not.toMatch(/open_id|tenant_access_token|app_secret/i);
```

- [ ] **Step 2: Add failing adapter request tests**

Mock create response `{ task, notification }`, then assert the returned task contains the safe notification field. Call `retryTaskNotification("t1")` and assert `POST /api/workstation/tasks/t1/notify` with same-origin credentials.

- [ ] **Step 3: Run and verify RED**

Run: `npm run test:unit -- src/features/workstation/server-bootstrap.test.ts src/app/api/workstation/bootstrap/handler.test.ts && npm run test:html -- tests/html-workstation-server-adapter.test.mjs`

Expected: FAIL because notification rows and retry adapter are absent.

- [ ] **Step 4: Load and map safe queue fields**

Select visible `task_notifications` alongside projects, tasks and salary. Map queue rows by internal task ID and pass only `status` and `last_error_code` into `buildServerBootstrap()`. Default missing rows to `{ status: "unavailable", errorCode: "recipient_unavailable" }` only for formal tasks; do not synthesize this field for demo snapshots.

```ts
const notificationByTask = new Map(
  (notificationsResult.data ?? []).map((row) => [row.task_id, {
    status: row.status,
    errorCode: row.last_error_code ?? "",
  }]),
);

tasks: (tasksResult.data ?? []).map((row) => ({
  publicId: row.public_id,
  projectId: row.project_id,
  title: row.title,
  description: row.description,
  assigneeMemberId: row.assignee_member_id,
  reporterMemberId: row.reporter_member_id,
  status: row.status,
  priority: row.priority,
  startDate: row.start_date,
  dueDate: row.due_date,
  progress: Number(row.progress),
  acceptanceCriteria: row.acceptance_criteria,
  blocker: row.blocker,
  reviewNote: row.review_note,
  nextStep: row.next_step,
  resultSummary: row.result_summary,
  resultLink: row.result_link,
  resultFiles: Array.isArray(row.result_files)
    ? row.result_files.filter((item): item is string => typeof item === "string")
    : [],
  acceptedAt: row.accepted_at,
  submittedAt: row.submitted_at,
  reviewedAt: row.reviewed_at,
  notification: notificationByTask.get(row.id) ?? {
    status: "unavailable",
    errorCode: "recipient_unavailable",
  },
})),
```

When `last_error_code === "recipient_unavailable"`, `buildServerBootstrap()` must expose public status `unavailable`; otherwise preserve `pending`, `sent`, or `failed`.

- [ ] **Step 5: Update the adapter without breaking task callers**

Implement:

```js
createTask: function (input) {
  return request("/api/workstation/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input || {}),
  }).then(function (result) {
    var task = addTask(result.task);
    task.notification = clone(result.notification || { status: "unavailable" });
    return task;
  });
},
retryTaskNotification: function (taskId) {
  return request("/api/workstation/tasks/" + encodeURIComponent(taskId) + "/notify", {
    method: "POST",
  }).then(function (result) { return clone(result.notification); });
},
```

Add `retryTaskNotification` to the formal gateway management method list.

- [ ] **Step 6: Run and verify GREEN**

Run: `npm run test:unit -- src/features/workstation/server-bootstrap.test.ts src/app/api/workstation/bootstrap/handler.test.ts && node --test tests/html-workstation-server-adapter.test.mjs`

Expected: PASS for server mapping and adapter request contracts.

- [ ] **Step 7: Commit Bootstrap and adapter support**

```powershell
git add -- src/app/api/workstation/bootstrap/handler.ts src/app/api/workstation/bootstrap/handler.test.ts src/features/workstation/server-bootstrap.ts src/features/workstation/server-bootstrap.test.ts public/workstation-server-adapter.js tests/html-workstation-server-adapter.test.mjs
git commit -m "feat: expose safe task notification status"
```

---

### Task 7: Add deep-link startup, delivery feedback and retry UI

**Files:**
- Modify: `quantxy-ai-workbench-fused.html`
- Modify: `public/quantxy-ai-workbench-fused.html`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`
- Modify: `tests/html-fusion-contract.test.mjs`

**Interfaces:**
- Query: `?formal=1&task=<uuid>`.
- Produces: `applyTaskDeepLink()`, manager action `retry-task-notification`.

- [ ] **Step 1: Add failing HTML behavior tests**

Add a formal-mode JSDOM fixture with a compliant server adapter and test:

```js
test("opens one authorized UUID task from a formal deep link", async () => {
  const dom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1&task=11111111-1111-4111-8111-111111111111",
    formalBootstrap,
  );
  assert.equal(dom.window.Q.S.page, "execution");
  assert.equal(dom.window.Q.S.sel.task, "11111111-1111-4111-8111-111111111111");
  dom.window.close();
});
```

Also assert invalid UUID is ignored, unauthorized UUID returns to `me` with generic wording, failed task creation says “任务已创建，飞书通知暂未送达”, and only `task.manage` users see “重发飞书通知”.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/html-personal-workbench-behavior.test.mjs tests/html-fusion-contract.test.mjs`

Expected: FAIL because no task query parsing or retry action exists.

- [ ] **Step 3: Implement safe deep-link application**

Add one UUID pattern and:

```js
function applyTaskDeepLink(){
  if(isDemoRuntime()) return '';
  var params=new URLSearchParams(window.location.search), values=params.getAll('task');
  if(values.length!==1||!TASK_UUID_PATTERN.test(values[0])) return '';
  if(WORKSTATION_GATEWAY.loadMyTask(S.me,values[0])){
    S.sel.task=values[0]; S.page='execution'; return '';
  }
  S.page='me'; return '任务不存在或当前账号无权查看';
}
```

Call it only after formal Bootstrap and session identity are ready. Render first, then show the generic startup toast. The existing login URL already preserves the complete relative path through `next`; retain the current safe-return validation tests.

- [ ] **Step 4: Render notification status and manager retry**

In task creation success, choose one of these exact messages from `task.notification.status`:

- `sent`: `任务已创建，飞书通知已送达`
- `failed`: `任务已创建，飞书通知暂未送达`
- `unavailable`: `任务已创建，请先同步该员工的飞书身份`
- `pending`: `任务已创建，飞书通知正在发送`

In `viewExecution()`, render a compact status row. Only when `hasWorkstationPermission('task.manage')` and status is `failed` or `unavailable`, render `<button data-act="retry-task-notification">重发飞书通知</button>`.

- [ ] **Step 5: Wire retry action**

Call `WORKSTATION_GATEWAY.retryTaskNotification(S.sel.task)`, update `task.notification`, rerender and toast success/failure. Disable the button while the promise is pending using `S.notificationRetryBusy`.

- [ ] **Step 6: Keep both HTML files synchronized and verify GREEN**

Run:

```powershell
Copy-Item -LiteralPath 'quantxy-ai-workbench-fused.html' -Destination 'public\quantxy-ai-workbench-fused.html' -Force
node --test tests/html-personal-workbench-behavior.test.mjs tests/html-fusion-contract.test.mjs tests/html-workstation-server-adapter.test.mjs
```

Expected: PASS for authorized deep link, invalid parameter, unauthorized task, create feedback, retry permission and both HTML contracts.

- [ ] **Step 7: Commit the formal UI flow**

```powershell
git add -- quantxy-ai-workbench-fused.html public/quantxy-ai-workbench-fused.html tests/html-personal-workbench-behavior.test.mjs tests/html-fusion-contract.test.mjs
git commit -m "feat: open Feishu task links in the workbench"
```

---

### Task 8: Document deployable configuration and release boundaries

**Files:**
- Modify: `.env.example`
- Modify: `docs/deployment/phase1-supabase-feishu.md`

**Interfaces:**
- Documents: `NEXT_PUBLIC_APP_URL`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 1: Add a failing documentation contract**

Extend `src/features/feishu/task-notification.test.ts` to read `.env.example` and assert all four names exist, no real key-like value exists, and `NEXT_PUBLIC_APP_URL` is described as the employee-accessible deployment origin.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:unit -- src/features/feishu/task-notification.test.ts`

Expected: FAIL until the notification-specific descriptions are present.

- [ ] **Step 3: Update configuration guidance**

Document that production multi-user use should set:

```text
NEXT_PUBLIC_APP_URL=https://workstation.example.com
FEISHU_APP_ID=cli_your_feishu_app_id
FEISHU_APP_SECRET=your_server_only_feishu_app_secret
SUPABASE_SERVICE_ROLE_KEY=your_server_only_supabase_service_role_key
```

Explain that the app URL is compiled into task links, secrets remain runtime-only, the Feishu app must publish a new version containing robot capability and `im:message:send_as_bot`, and app availability must include the employees who will receive tasks. Do not place real values in documentation.

- [ ] **Step 4: Run tests and commit documentation**

Run: `npm run test:unit -- src/features/feishu/task-notification.test.ts`

Expected: PASS.

```powershell
git add -- .env.example docs/deployment/phase1-supabase-feishu.md src/features/feishu/task-notification.test.ts
git commit -m "docs: add Feishu notification deployment checklist"
```

---

### Task 9: Verify the complete local release candidate

**Files:**
- Modify only files required to fix failures introduced by Tasks 1-8.

**Interfaces:**
- Produces: a local build ready for migration, server deployment and one designated employee acceptance test.

- [ ] **Step 1: Run focused notification tests**

Run:

```powershell
npm run test:unit -- src/features/feishu/task-notification.test.ts src/features/workstation/task-notification.test.ts src/features/workstation/task-notification-migration.test.ts src/app/api/workstation/tasks/handler.test.ts 'src/app/api/workstation/tasks/[taskId]/notify/handler.test.ts' src/app/api/workstation/bootstrap/handler.test.ts src/features/workstation/server-bootstrap.test.ts
node --test tests/html-personal-workbench-behavior.test.mjs tests/html-workstation-server-adapter.test.mjs tests/html-fusion-contract.test.mjs
```

Expected: all focused tests pass with zero real Feishu network requests.

- [ ] **Step 2: Run the full quality gate**

Run:

```powershell
npm run test:unit
npm run test:html
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: every command exits `0`; TypeScript and ESLint errors are not skipped.

- [ ] **Step 3: Perform a local browser acceptance check with mocked delivery**

Start the existing local preview, sign in with the configured Feishu test identity, create a task assigned to the test employee, and verify the UI shows the mocked delivery result. Open a generated task deep link and verify it lands on the authorized execution detail with “领取任务”. Do not publish the Feishu app version and do not send to a real employee in this local step.

- [ ] **Step 4: Record the release handoff**

Report the final commit, migration filename, required environment variable names, the still-unpublished Feishu app version, and the remaining production sequence:

1. Push code and migration.
2. Deploy with the employee-accessible HTTPS `NEXT_PUBLIC_APP_URL`.
3. Apply `202608200001_feishu_task_notifications.sql`.
4. Send one task to a designated test employee.
5. Publish the Feishu app version after that end-to-end test passes.
6. Expand Feishu app availability to all intended employees.

- [ ] **Step 5: Confirm verification did not create unreviewed changes**

Run: `git status --short`

Expected: verification itself creates no new files or modifications. If a quality gate failed, return to the task that owns the failing file, repeat that task's RED/GREEN cycle, and use that task's explicit commit command instead of creating a separate verification commit.
