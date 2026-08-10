# 量子星河 AI企业大脑 V1.0 第一阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有业务页面的前提下，为量子星河建立可扩展 OAuth Provider、显式租户边界、真实员工身份、五岗位 RBAC、组织身份审计、服务端路由保护和数据库 RLS 基线；V1.0 当前只启用飞书和量子星河一个租户。

**Architecture:** Supabase Auth 通过小型 Provider Registry 启动企业 OAuth，V1.0 Registry 只启用 `feishu -> custom:feishu`；飞书代码只是 UserInfo Adapter，数据库预置、身份认领、会话和权限核心均使用 Provider 无关合同。`tenants` 是 SaaS 顶层边界，量子星河租户下只种子化一个主组织；身份/RBAC/审计表显式携带 `tenant_id`，组合约束和 RLS 阻止跨租户引用。数据库预置“受邀成员 + 员工档案 + 外部身份 + 角色”，首次登录由通用安全函数绑定，随后 Middleware、Workspace Layout、Server Action 和 RLS 分层校验；现有本地业务数据暂不迁移，通过只读兼容投影保持页面可浏览。

**Tech Stack:** Next.js 15.5.22 App Router、React 19.2.4、TypeScript 5、Tailwind CSS 4、Shadcn、Supabase Auth/PostgreSQL/RLS、`@supabase/ssr` 0.12.4、Vitest 4、Testing Library、Playwright 1.62、Supabase CLI、pgTAP。

## Global Constraints

- 系统运行时只供“量子星河”一家企业内部使用；新增 `tenants` 和显式 `tenant_id` 作为未来 SaaS 边界，只种子化 `quantxy` 租户与 `quantum-galaxy` 主组织，但不提供租户创建、选择、切换、计费、跨租户后台或相关 UI。
- `organizations` 是租户内组织结构，不是租户本身；身份、组织、RBAC 和审计关系必须使用 `(tenant_id, id)` 组合约束/外键或等价守卫，并由 RLS 先限定当前租户。
- Supabase 使用 Cloud 新加坡区域和付费方案；香港 Ubuntu 22.04 服务器在第四阶段承载 Next.js、Nginx 和 n8n。
- 所有正式员工统一使用企业 OAuth；关闭邮箱密码注册、匿名注册和自助注册入口。V1.0 登录页只显示“使用飞书登录”，但登录动作必须通过 Provider Registry 的通用启动边界。
- 当前 Provider 采用 Supabase Auth `custom:feishu`；飞书 UserInfo 是首个 Provider Adapter，不得让员工预置、身份认领、`WorkspaceSession` 或数据库授权依赖飞书专属字段。旧版 `docs/superpowers/plans/2026-08-05-feishu-oauth-login.md` 的自制 HMAC Cookie 会话方案作废，不得实施。
- 飞书 App Secret、Supabase `service_role`、OAuth 授权码、用户访问令牌不得进入浏览器 Bundle、普通 Cookie、HTML、日志、截图或 Git。
- 正式权限只信任服务端 `WorkspaceSession`、数据库角色和 RLS；兼容 `actor` 仅供第一阶段读取现有演示页面，禁止用于数据库授权或正式写入。
- `WorkspaceSession` 必须携带 `tenantId` 以及 `{ providerCode, authProvider, providerSubject }` Provider 无关身份摘要；普通页面不得读取 Provider Token、飞书 open_id/union_id 或 provider tenant key。
- 通用员工预置只能由 `service_role` 调用；`authenticated` 只能认领当前登录身份匹配的既有预置记录，未知用户不得自助创建成员或档案。
- `audit_logs` 在第一阶段只记录身份、用户、权限和名单预置事件，必须 tenant-scoped、append-only；浏览器不得直接写入，metadata 必须净化且不得含 Secret、Token、OAuth code、Authorization/Cookie、service_role 或原始 IP。
- `employee_profiles.skills` 使用 `text[]`、默认空数组、最多 30 项；每项去首尾空白、英文小写、去重且长度 1–40 字符。第一阶段不实现 AI 匹配、推荐或打分。
- 第一阶段不迁移项目、任务、文件、审批、考勤、薪资等业务写入；这些页面保持可浏览，真实数据迁移从第二阶段开始。
- 第一阶段不引入 LangGraph、Dify、n8n、AI 模型 Provider、Agent、AI 匹配、CRM、复杂 ERP、OA 流程设计器或移动端 App。
- 登录页和状态页沿用现有白色、浅蓝渐变、透明卡片、大圆角的玻璃拟态风格，不做传统 OA 蓝色后台。
- 每个页面只保留一个明显主操作；错误文案面向非技术员工，不显示 OAuth、JWT、RLS、RPC、provider token 等术语。
- 所有代码步骤遵循 TDD：先看到预期失败，再写最小实现，再运行定向测试和完整回归。
- 不删除或覆盖现有用户改动；每个任务单独提交，提交前运行 `git diff --check`。

---

## Existing Baseline

- 已有 Supabase 浏览器端和服务端客户端：`src/lib/supabase/client.ts`、`src/lib/supabase/server.ts`、`src/lib/supabase/env.ts`。
- 已有 `organizations`、`organization_members`、`roles`、`permissions`、`member_roles`、`role_permissions`、`files`、`departments`、`employee_profiles` 及基础 RLS。
- 数据库角色代码继续使用 `owner`、`admin`、`department_head`、`employee`、`finance`、`hr`；界面岗位映射为 CEO、管理层、普通员工、财务、人事。
- 现有 `DemoSessionProvider` 通过 `localStorage` 切换身份，约 30 个组件消费 `useDemoSession()`；必须一次机械迁移并以搜索结果为零作为验收。
- 现有业务页面仍读取 localStorage/IndexedDB；这是第二阶段及第四阶段的迁移范围，第一阶段不得误称已经完成全部数据迁移。
- 当前 45 个测试文件、186 个单元测试、类型检查、Lint 和构建均通过；新增认证后必须保持这些基线为绿。
- Task 1 的飞书 UserInfo Adapter 已实现并完成审查；它只作为 Provider Adapter 保留，不视为通用身份核心。
- Task 2 在提交 `57985f4` 有一次飞书专用、单组织的初稿；该初稿必须按本计划修订并重新审查后才能接受。当前本机没有 Docker/Podman，`supabase db reset` 和 pgTAP 仍是环境验证缺口，不得宣称数据库集成测试已完成。

## Phase 1 Boundary

本计划交付：

1. 飞书 OAuth UserInfo Provider Adapter；通用 OAuth Provider Registry 预留扩展能力。
2. `tenants`、Provider 无关身份、员工预置/认领、五岗位 RBAC、`skills` 和 `audit_logs` 数据库迁移。
3. 携带 `tenantId` 与 Provider 无关身份摘要的 Supabase SSR 真实会话和路由保护。
4. 当前启用的飞书登录、回调、退出、未开通和停用提示。
5. 真实员工信息替换演示身份切换，现有业务页面继续可浏览。
6. 五岗位与跨租户自动化权限矩阵、真实飞书联调和运维手册。

本计划不交付：项目/任务/文件真实写入、业务工作流审计、AI 战略中心、Agent、AI 任务匹配、知识库、Dify、n8n、飞书通知、租户管理 UI 及全部旧页面内容清理。这些需求已保留在总设计的第二至第四阶段，不代表取消。

**Amendment precedence:** 本次新增的 Global Constraints、Task 2 Mandatory revised contract 以及 Task 3/5/7/8/9 amendment notes，优先于下方尚未机械改写的旧示例。旧示例若出现飞书专用核心、无 `tenant_id`、`claim_current_feishu_identity`、`provision_feishu_employee` 作为唯一入口或把身份审计延后等冲突，只能视为适配器/历史说明，不得作为实现或验收依据。

## File Map

### Create

- `src/features/auth/auth-env.ts`: 服务端认证环境变量解析和 URL 校验。
- `src/features/auth/auth-env.test.ts`: 环境变量缺失、协议和脱敏测试。
- `src/features/auth/feishu-userinfo.ts`: 飞书用户信息响应校验和 OAuth 标准化；只负责 Provider Adapter。
- `src/features/auth/feishu-userinfo.test.ts`: 正常、租户不符、Token 缺失、上游失败测试。
- `src/app/api/auth/feishu/userinfo/route.ts`: 供 Supabase Custom OAuth 调用的公开 UserInfo 适配端点。
- `supabase/migrations/202608100001_phase1_identity_rbac.sql`: 修订现有 Task 2 初稿，新增租户边界、Provider 无关身份、技能标签、审计、预置/认领函数和 tenant-scoped RLS。
- `supabase/config.toml`: Supabase CLI 本地数据库与仅限 E2E 的邮箱测试登录配置。
- `src/lib/supabase/phase1-identity-migration.test.ts`: 不依赖 Docker 的迁移契约测试。
- `supabase/tests/phase1_identity_rbac.sql`: 本地 PostgreSQL/pgTAP 身份和 RLS 集成测试。
- `src/features/auth/workspace-session-types.ts`: 数据库角色、界面岗位、真实会话和访问状态类型。
- `src/features/auth/workspace-access.ts`: RPC 结果校验、主岗位选择、岗位首页和兼容 actor 投影。
- `src/features/auth/workspace-access.test.ts`: 五岗位映射、停用、缺档案和兼容投影测试。
- `src/features/auth/workspace-session.ts`: 服务端读取/强制要求 Workspace 会话。
- `src/features/auth/workspace-session-provider.tsx`: 客户端只读会话 Context。
- `src/features/auth/workspace-session-provider.test.tsx`: Provider 必需性和只读 actor 测试。
- `src/lib/supabase/middleware.ts`: Request/Response Cookie 适配和 Supabase 会话刷新。
- `src/middleware.ts`: 未登录、未开通、停用和岗位越权的服务端路由保护。
- `src/features/auth/route-policy.test.ts`: 公开路由和五岗位路由矩阵测试。
- `src/features/auth/oauth-provider-registry.ts`: Provider Registry、通用 OAuth 启动定义和当前启用 Provider 查询。
- `src/features/auth/oauth-provider-registry.test.ts`: 当前只启用飞书、未知 Provider 拒绝和无飞书专属会话依赖测试。
- `src/features/auth/actions.ts`: 发起飞书 OAuth 与退出登录 Server Actions。
- `src/features/auth/login-card.tsx`: 简洁飞书登录卡片。
- `src/features/auth/login-card.test.tsx`: 登录页主操作和错误文案测试。
- `src/app/login/page.tsx`: 飞书登录页和已登录跳转。
- `src/app/auth/callback/route.ts`: 交换 Supabase PKCE code、绑定身份并按岗位跳转。
- `src/app/auth/callback/route.test.ts`: 回调成功、未开通、停用和错误测试。
- `src/app/access-pending/page.tsx`: 未开通、停用、离职和配置异常状态页。
- `scripts/phase1/provision-roster.mjs`: 从本地 JSON 名单把飞书字段映射为通用身份合同并调用受限 RPC 预置员工。
- `scripts/phase1/provision-roster.test.mjs`: 名单字段、角色、技能标签、Provider 和重复标识校验测试。
- `docs/deployment/phase1-supabase-feishu.md`: 非技术化的 Supabase、飞书、名单导入和验收手册。
- `tests/e2e/auth-state.ts`: 通过本地 Supabase 生成 Playwright Cookie 状态。
- `tests/e2e/global-setup.ts`: 在浏览器测试前生成五岗位认证状态。
- `tests/e2e/phase1-auth-rbac.spec.ts`: 未登录和五岗位路由验收。

### Modify

- `.env.example`: 增加应用 URL、当前飞书 Adapter 租户和仅服务端运维变量说明；不得把它作为应用租户 ID。
- `.gitignore`: 忽略真实员工名单和 Playwright 认证状态。
- `package.json`: 增加数据库和阶段一验收脚本。
- `package-lock.json`: 锁定显式使用的 `@next/env` 15.5.22。
- `src/lib/supabase/server.ts`: 保持 Server Component Cookie 客户端，删除“未来代理”注释。
- `src/lib/supabase/client.ts`: 保持浏览器 Cookie 会话客户端。
- `src/app/(workspace)/layout.tsx`: 服务端强制真实会话并传给 Shell。
- `src/app/page.tsx`: 已登录进入岗位首页，未登录进入 `/login`。
- `src/app/layout.tsx`: 品牌标题更新为“量子星河 AI企业大脑”。
- `src/components/shell/workspace-shell.tsx`: 用 `WorkspaceSessionProvider` 替换 `DemoSessionProvider`。
- `src/components/shell/workspace-header.tsx`: 显示真实姓名/头像，移除演示切换，接入真实退出。
- `src/components/shell/app-sidebar.tsx`: 使用真实岗位会话。
- `src/components/shell/mobile-workspace-nav.tsx`: 使用真实岗位会话。
- `src/components/shell/role-access-guard.tsx`: 使用真实岗位会话作为客户端二次提示。
- `src/components/shell/workspace-search-dialog.tsx`: 使用兼容 actor 读取现有演示内容。
- `src/components/shell/workspace-shell.test.tsx`: 注入真实会话 fixture，验证无演示切换。
- `src/config/navigation.ts`: 使用 `WorkspaceRole`，不再引用 `DemoRole`。
- `src/features/operations/operations-types.ts`: 使用 `WorkspaceRole`/`WorkspaceActor`，去除身份模型中的 Demo 命名。
- `src/features/operations/operations-data.ts`: 仅保留阶段一业务 fixture，不再导出浏览器身份存储常量。
- `src/features/operations/role-access.ts`: 改为 `WorkspaceRole` 路由策略。
- `src/features/operations/role-access.test.ts`: 扩充真实岗位访问矩阵。
- `src/features/activities/activities-page.tsx`
- `src/features/analytics/analytics-workspace.tsx`
- `src/features/approvals/approvals-workspace.tsx`
- `src/features/attendance/attendance-operating-panels.tsx`
- `src/features/attendance/attendance-workspace.tsx`
- `src/features/help/help-center.tsx`
- `src/features/hr/employee-detail-page.tsx`
- `src/features/hr/people-workspace.tsx`
- `src/features/operations/leave-workbench.tsx`
- `src/features/operations/notification-center.tsx`
- `src/features/operations/operational-approval-queue.tsx`
- `src/features/operations/operational-knowledge-panel.tsx`
- `src/features/operations/payroll-control-panel.tsx`
- `src/features/operations/role-workbench.tsx`
- `src/features/projects/components/project-reports-tab.tsx`
- `src/features/projects/project-detail-workspace.tsx`
- `src/features/projects/projects-workspace.tsx`
- `src/features/salary/payroll-workspace.tsx`
- `src/features/tasks/task-center-workspace.tsx`: 以上业务组件机械改用 `useWorkspaceSession()`，不改业务逻辑。
- `playwright.config.ts`: 使用本地 Supabase 的真实测试会话，不加入生产认证旁路。
- `tests/e2e/dashboard.spec.ts`: 更新已经落后于当前 Dashboard 的称呼断言。

### Delete

- `src/features/operations/demo-session.tsx`: 删除 localStorage 身份切换和演示用户 Context。

---

### Task 1: 飞书 UserInfo 标准化边界

**Execution note:** 本任务已实现并完成审查。它仅是首个 OAuth Provider Adapter，负责把飞书响应交给 Supabase Auth；后续任务不得把这里的 `open_id`、`union_id` 或 `tenant_key` 直接变成应用会话、员工预置或授权合同。

**Files:**
- Create: `src/features/auth/auth-env.test.ts`
- Create: `src/features/auth/auth-env.ts`
- Create: `src/features/auth/feishu-userinfo.test.ts`
- Create: `src/features/auth/feishu-userinfo.ts`
- Create: `src/app/api/auth/feishu/userinfo/route.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_APP_URL`、`FEISHU_TENANT_KEY`、请求头 `Authorization: Bearer <user_access_token>`。
- Produces: `getAuthEnv(env?)`、`normalizeFeishuUserInfo(body, tenantKey)`、`handleFeishuUserInfo(request, dependencies)`、`GET /api/auth/feishu/userinfo`；输出只供 `custom:feishu` Adapter/Supabase identity data 使用，通用身份核心从 Task 2 开始。

- [ ] **Step 1: 写环境变量失败测试**

```ts
import { describe, expect, it } from "vitest";
import { getAuthEnv } from "@/features/auth/auth-env";

describe("auth environment", () => {
  it("requires an absolute app URL and a Feishu tenant key", () => {
    expect(() => getAuthEnv({})).toThrow("认证配置缺失");
    expect(() => getAuthEnv({ NEXT_PUBLIC_APP_URL: "dashboard", FEISHU_TENANT_KEY: "tenant" })).toThrow("应用地址必须使用 http 或 https");
  });

  it("returns only non-secret runtime values", () => {
    expect(getAuthEnv({ NEXT_PUBLIC_APP_URL: "https://brain.quantxy.com", FEISHU_TENANT_KEY: "tenant_qxy" })).toEqual({
      appUrl: "https://brain.quantxy.com",
      feishuTenantKey: "tenant_qxy",
    });
  });
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `npx vitest run src/features/auth/auth-env.test.ts`

Expected: FAIL，提示无法解析 `@/features/auth/auth-env`。

- [ ] **Step 3: 实现认证环境解析**

```ts
export type AuthEnv = { appUrl: string; feishuTenantKey: string };

export function getAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  const feishuTenantKey = env.FEISHU_TENANT_KEY?.trim();
  if (!appUrl || !feishuTenantKey) throw new Error("认证配置缺失");
  let parsed: URL;
  try { parsed = new URL(appUrl); } catch { throw new Error("应用地址必须使用 http 或 https"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("应用地址必须使用 http 或 https");
  }
  return { appUrl: parsed.origin, feishuTenantKey };
}
```

- [ ] **Step 4: 写 UserInfo 适配失败测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { handleFeishuUserInfo, normalizeFeishuUserInfo } from "@/features/auth/feishu-userinfo";

const feishuBody = {
  code: 0,
  data: {
    open_id: "ou_qxy_001",
    union_id: "on_qxy_001",
    tenant_key: "tenant_qxy",
    name: "量子员工",
    avatar_url: "https://example.com/avatar.png",
  },
};

it("maps the Feishu envelope to an OAuth-compatible root object", () => {
  expect(normalizeFeishuUserInfo(feishuBody, "tenant_qxy")).toEqual({
    sub: "ou_qxy_001",
    name: "量子员工",
    picture: "https://example.com/avatar.png",
    open_id: "ou_qxy_001",
    union_id: "on_qxy_001",
    tenant_key: "tenant_qxy",
  });
});

it("rejects another Feishu tenant without reflecting the token", async () => {
  const request = new Request("https://brain.quantxy.com/api/auth/feishu/userinfo", {
    headers: { Authorization: "Bearer sensitive-user-token" },
  });
  const response = await handleFeishuUserInfo(request, {
    tenantKey: "tenant_qxy",
    fetchImpl: vi.fn(async () => Response.json({ ...feishuBody, data: { ...feishuBody.data, tenant_key: "tenant_other" } })),
  });
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("sensitive-user-token");
});

it("rejects a missing bearer token before calling Feishu", async () => {
  const fetchImpl = vi.fn();
  const response = await handleFeishuUserInfo(new Request("https://brain.quantxy.com/api/auth/feishu/userinfo"), { tenantKey: "tenant_qxy", fetchImpl });
  expect(response.status).toBe(401);
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("returns a stable gateway error for a failed Feishu request", async () => {
  const response = await handleFeishuUserInfo(new Request("https://brain.quantxy.com/api/auth/feishu/userinfo", {
    headers: { Authorization: "Bearer test-token" },
  }), { tenantKey: "tenant_qxy", fetchImpl: vi.fn(async () => new Response("unavailable", { status: 503 })) });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "upstream_failed" });
});
```

- [ ] **Step 5: 运行测试并确认模块不存在**

Run: `npx vitest run src/features/auth/feishu-userinfo.test.ts`

Expected: FAIL，提示无法解析 `@/features/auth/feishu-userinfo`。

- [ ] **Step 6: 实现严格校验和代理处理器**

```ts
const FEISHU_USERINFO_URL = "https://open.feishu.cn/open-apis/authen/v1/user_info";

type FeishuEnvelope = {
  code?: number;
  data?: Record<string, unknown>;
};

export function normalizeFeishuUserInfo(body: FeishuEnvelope, tenantKey: string) {
  const data = body.data;
  if (body.code !== 0 || !data) throw new Error("invalid_feishu_response");
  if (data.tenant_key !== tenantKey) throw new Error("wrong_feishu_tenant");
  if (typeof data.open_id !== "string" || typeof data.union_id !== "string" || typeof data.name !== "string") {
    throw new Error("invalid_feishu_identity");
  }
  return {
    sub: data.open_id,
    name: data.name,
    ...(typeof data.avatar_url === "string" ? { picture: data.avatar_url } : {}),
    ...(typeof data.email === "string" ? { email: data.email } : {}),
    open_id: data.open_id,
    union_id: data.union_id,
    tenant_key: data.tenant_key,
  };
}

export async function handleFeishuUserInfo(
  request: Request,
  dependencies: { tenantKey: string; fetchImpl?: typeof fetch },
) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 4096) {
    return Response.json({ error: "invalid_request" }, { status: 401 });
  }
  try {
    const upstream = await (dependencies.fetchImpl ?? fetch)(FEISHU_USERINFO_URL, {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: authorization, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) return Response.json({ error: "upstream_failed" }, { status: 502 });
    const identity = normalizeFeishuUserInfo(await upstream.json() as FeishuEnvelope, dependencies.tenantKey);
    return Response.json(identity, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const wrongTenant = error instanceof Error && error.message === "wrong_feishu_tenant";
    return Response.json(
      { error: wrongTenant ? "wrong_feishu_tenant" : "upstream_failed" },
      { status: wrongTenant ? 403 : 502 },
    );
  }
}
```

路由只做依赖装配：

```ts
import { getAuthEnv } from "@/features/auth/auth-env";
import { handleFeishuUserInfo } from "@/features/auth/feishu-userinfo";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleFeishuUserInfo(request, { tenantKey: getAuthEnv().feishuTenantKey });
}
```

- [ ] **Step 7: 补充环境变量示例并验证**

`.env.example` 增加：

```dotenv
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
FEISHU_TENANT_KEY=tenant_key_from_feishu_admin
# 仅本地名单导入脚本读取；不得使用 NEXT_PUBLIC_ 前缀，不得部署到浏览器环境。
SUPABASE_SERVICE_ROLE_KEY=server_only_service_role_key
PHASE1_ROSTER_PATH=private/phase1-roster.json
```

Run: `npx vitest run src/features/auth/auth-env.test.ts src/features/auth/feishu-userinfo.test.ts`

Expected: PASS；测试输出和响应体均不含 `sensitive-user-token`。

- [ ] **Step 8: 提交**

```bash
git add .env.example src/features/auth/auth-env.ts src/features/auth/auth-env.test.ts src/features/auth/feishu-userinfo.ts src/features/auth/feishu-userinfo.test.ts src/app/api/auth/feishu/userinfo/route.ts
git commit -m "feat: add feishu oauth userinfo adapter"
```

---

### Task 2: 租户化、Provider 无关身份、员工预置、RBAC 与审计迁移

#### Mandatory revised contract (supersedes conflicting Task 2 samples below)

Task 2 在提交 `57985f4` 的初稿尚未接受。实施者必须修改现有迁移、静态契约测试和 pgTAP；完成下列合同并重新审查后，Task 2 才能标记完成。下方任何 Feishu-only 表、函数或 SQL 片段最多是 `custom:feishu` 兼容包装器，不能定义身份核心。

**Schema contract:**

- 新建 `public.tenants`，字段至少为 `id`、`public_id`、`name`、`slug`、`status`、`created_at`、`updated_at`；只种子化一个 `('量子星河', 'quantxy')` 活跃租户。
- `organizations` 是租户下的组织，种子为 `('量子星河', 'quantum-galaxy')`；运行时没有租户注册、选择、切换、计费或跨租户 UI。
- `organizations`、`organization_members`、`departments`、`employee_profiles`、`roles`、`member_roles`、`role_permissions`、`identity_providers`、`external_identities`、`audit_logs` 必须显式含非空 `tenant_id`。`permissions` 保持全局只读目录。
- 为上述父表提供 `unique (tenant_id, id)`；组织成员、父部门、部门负责人、员工部门/经理、角色分配、Provider 身份和审计 actor/organization 使用 `(tenant_id, id)` 组合外键或等价触发器守卫。pgTAP 必须创建第二测试租户并证明跨租户引用失败。
- `employee_profiles.skills` 固定为 `text[] not null default '{}'::text[]`。写入时先拒绝超过 30 项、空标签或长度超过 40 字符，再进行 `btrim + lower + distinct` 规范化；第一阶段只存取标签，不实现 AI 匹配、推荐或打分。

**Provider-neutral identity contract:**

- 新建 `identity_providers(tenant_id, provider_code, auth_provider, provider_tenant_key, display_name, status, safe_metadata, ...)`；唯一键至少包含 `(tenant_id, provider_code)` 和 `(tenant_id, auth_provider)`。只种子化 `('feishu', 'custom:feishu')`，但禁止 `check (provider_code = 'feishu')`。
- `external_identities` 使用通用字段 `tenant_id`、`organization_id`、`organization_member_id`、`identity_provider_id`、`provider_subject`、`provider_tenant_key`、`provider_match_keys text[]`、`verified_email`、`auth_user_id`、`status`、`last_login_at`；不得把 `feishu_open_id`/`feishu_union_id` 作为核心列，不得保存 Token、OAuth code、App Secret 或 Cookie。
- 通用预置函数名固定为 `provision_employee_identity(...)`，参数必须包含 `p_tenant_slug`、`p_organization_slug`、`p_provider_code`、`p_provider_tenant_key`、`p_provider_subject`、`p_provider_match_keys` 和 `p_skills`；只允许 `service_role` 执行。可保留 `provision_feishu_employee(...)` 薄包装器，但它也只能由 `service_role` 执行且只负责字段映射。
- 通用管理员修复/E2E 绑定函数名固定为 `bind_preprovisioned_identity(...)`，只允许 `service_role` 执行。
- 当前用户认领函数名固定为 `claim_current_identity()`，只读取 `auth.uid()` 与 `auth.identities`，不得接收浏览器提交的 subject/match key。它先把 Provider Adapter 数据归一为 `auth_provider/provider_subject/provider_tenant_key/provider_match_keys/verified_email/display_name/avatar_url`，再匹配已预置身份；未知用户返回 `not_provisioned` 且不得自建成员。
- `current_workspace_access()` 通过当前绑定身份解析租户，不得把 `organization.slug = 'quantum-galaxy'` 当授权条件；返回 `tenantId`、`providerCode`、`authProvider`、`providerSubject`，且不返回 provider tenant key、match keys、open_id、union_id 或 Token。

**Audit contract:**

- 新建 `audit_logs`，至少含 `tenant_id`、可选 `organization_id`、`actor_auth_user_id`、`actor_member_id`、`action`、`target_type`、`target_id`、`request_id`、`ip_hash`、`metadata jsonb`、`created_at`。
- 第一阶段 action 白名单只覆盖 `identity.provisioned`、`identity.claimed`、`identity.revoked`、`member.status_changed`、`member.role_changed`、`profile.updated`、`roster.imported`；不记录项目、任务、文件、AI 或 Agent 工作流。
- 日志 tenant-scoped、append-only。`public/anon/authenticated` 无直接 insert/update/delete 权限；owner/admin 只可读取当前租户，普通员工和另一租户不可读取。受控数据库函数可追加净化记录，update/delete 触发器必须拒绝修改历史。
- `metadata` 必须为对象且序列化后不超过 8192 bytes；所有层级键名大小写不敏感地拒绝 `token|secret|authorization|code|cookie|service_role`。只保存 IP HMAC/hash 摘要，不保存原始 IP。
- 通用预置、身份认领、状态/角色/档案变更必须在同一事务追加相应审计，不记录原始 OAuth claims。

**RLS and validation contract:**

- `current_tenant_id()` 从当前已绑定且有效的身份/成员解析租户。所有身份、组织、RBAC 和审计 RLS 先校验 `row.tenant_id = current_tenant_id()`，再校验本人或角色；单企业种子不是绕过租户条件的理由。
- pgTAP 覆盖五岗位、第二 Provider 可预置、跨租户 FK/RLS 拒绝、未知/停用/离职/撤销身份、service_role-only RPC、审计直写/修改拒绝、审计跨租户不可见，以及 skills 默认值/规范化/上限。
- 静态 Vitest 只能证明迁移文本合同。当前本机没有 Docker/Podman，因此 `npx supabase db reset` 和 `npx supabase test db` 必须记录为 `NOT RUN — ENVIRONMENT BLOCKED`，直到在支持的容器环境或开发 Supabase 执行成功；不得据此宣称云端迁移或 RLS 已完成。

**Files:**
- Modify: `supabase/migrations/202608100001_phase1_identity_rbac.sql`
- Modify: `src/lib/supabase/phase1-identity-migration.test.ts`
- Modify: `supabase/tests/phase1_identity_rbac.sql`
- Keep/Create as needed: `supabase/config.toml`

**Interfaces:**
- Consumes: 现有 `organizations`、`organization_members`、`roles`、`permissions`、`member_roles`、`role_permissions`、`departments`、`employee_profiles`、`auth.users`、`auth.identities`，以及 Task 1 的飞书 Provider Adapter identity data。
- Produces: `tenants`、`identity_providers`、`external_identities`、`audit_logs`、`employee_profiles.skills`、`provision_employee_identity(...)`、`bind_preprovisioned_identity(...)`、`claim_current_identity()`、`current_tenant_id()`、`current_workspace_access()`、量子星河租户/主组织及五个部门种子。

- [ ] **Step 1: 写迁移契约失败测试**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("phase 1 tenant identity migration", () => {
  const sql = readFileSync(resolve("supabase/migrations/202608100001_phase1_identity_rbac.sql"), "utf8");

  it("adds tenant and provider-neutral identity boundaries", () => {
    expect(sql).toContain("create table public.tenants");
    expect(sql).toContain("create table public.identity_providers");
    expect(sql).toContain("create table public.external_identities");
    expect(sql).toContain("provider_code");
    expect(sql).toContain("auth_provider");
    expect(sql).toContain("provider_subject");
    expect(sql).toContain("provider_tenant_key");
    expect(sql).toContain("alter column user_id drop not null");
    expect(sql).toContain("create or replace function public.provision_employee_identity");
    expect(sql).toContain("create or replace function public.bind_preprovisioned_identity");
    expect(sql).toContain("create or replace function public.claim_current_identity");
    expect(sql).toContain("create or replace function public.current_tenant_id");
    expect(sql).toContain("create or replace function public.current_workspace_access");
    expect(sql).toContain("grant execute on function public.claim_current_identity() to authenticated");
    expect(sql).toContain("grant execute on function public.provision_employee_identity");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/grant execute on function public\.provision_employee_identity\([^;\n]+to authenticated;/i);
    expect(sql).not.toContain("claim_current_feishu_identity");
    expect(sql).not.toMatch(/check\s*\(\s*provider(?:_code)?\s*=\s*'feishu'\s*\)/i);
  });

  it("adds tenant-scoped audit logs and normalized employee skills", () => {
    for (const table of [
      "organizations", "organization_members", "departments", "employee_profiles",
      "roles", "member_roles", "role_permissions", "identity_providers",
      "external_identities", "audit_logs",
    ]) {
      expect(sql).toMatch(new RegExp(`(?:create|alter) table public\\.${table}[\\s\\S]*?tenant_id`, "i"));
    }
    expect(sql).toContain("skills text[]");
    expect(sql).toContain("default '{}'::text[]");
    expect(sql).toContain("create table public.audit_logs");
    expect(sql).toMatch(/revoke all on public\.audit_logs from public, anon, authenticated/i);
    expect(sql).toContain("8192");
    for (const forbidden of ["token", "secret", "authorization", "code", "cookie", "service_role"]) {
      expect(sql.toLowerCase()).toContain(forbidden);
    }
  });

  it("seeds one QuantXY tenant, one primary organization, and Feishu as the first provider", () => {
    expect(sql).toContain("'量子星河', 'quantxy'");
    expect(sql).toContain("'量子星河', 'quantum-galaxy'");
    expect(sql).toContain("'feishu', 'custom:feishu'");
    for (const name of ["AI事业部", "电商事业部", "运营部", "财务部", "人力资源部"]) {
      expect(sql).toContain(name);
    }
  });
});
```

- [ ] **Step 2: 运行修订后的测试并确认当前初稿不满足合同**

Run: `npx vitest run src/lib/supabase/phase1-identity-migration.test.ts`

Expected: FAIL against `57985f4`，明确缺少 `tenants`、`identity_providers`、通用 RPC、`audit_logs`、`skills` 或 tenant-aware 约束；不得把测试改回只接受飞书专用初稿。

- [ ] **Step 3: 按 Mandatory revised contract 重写租户、身份和组织迁移**

`organization_members.user_id` 允许为空，使员工可以在首次登录前先分配角色。下方旧 SQL 只说明已有表的改动起点；其中无 `tenant_id`、飞书专用列或单组织硬编码必须按本任务顶部合同替换，不能原样实施：

```sql
alter table public.organization_members alter column user_id drop not null;

alter table public.departments
  add column description text,
  add column leader_member_id bigint references public.organization_members(id) on delete set null;

create or replace function public.guard_department_leader()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.leader_member_id is not null and not exists (
    select 1 from public.organization_members member
    where member.id = new.leader_member_id
      and member.organization_id = new.organization_id
      and member.status in ('invited', 'active')
  ) then
    raise exception 'Department leader must belong to the same organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger departments_guard_leader
before insert or update of organization_id, leader_member_id on public.departments
for each row execute function public.guard_department_leader();

create table public.external_identities (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  organization_member_id bigint not null references public.organization_members(id) on delete cascade,
  provider text not null default 'feishu' check (provider = 'feishu'),
  provider_user_id text,
  feishu_open_id text,
  feishu_union_id text,
  tenant_key text not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, organization_member_id),
  check (status = 'invited' or feishu_open_id is not null or feishu_union_id is not null or provider_user_id is not null)
);

create unique index external_identities_provider_user_idx
  on public.external_identities(provider, provider_user_id)
  where provider_user_id is not null;
create unique index external_identities_feishu_open_idx
  on public.external_identities(tenant_key, feishu_open_id)
  where feishu_open_id is not null;
create unique index external_identities_feishu_union_idx
  on public.external_identities(tenant_key, feishu_union_id)
  where feishu_union_id is not null;
create unique index external_identities_auth_user_idx
  on public.external_identities(auth_user_id)
  where auth_user_id is not null;
create unique index employee_profiles_organization_work_email_idx
  on public.employee_profiles(organization_id, lower(work_email))
  where work_email is not null and deleted_at is null;

insert into public.organizations (name, slug)
values ('量子星河', 'quantum-galaxy')
on conflict (slug) do update set name = excluded.name;

with company as (
  select id from public.organizations where slug = 'quantum-galaxy'
)
insert into public.departments (organization_id, code, name, description, sort_order)
select company.id, seed.code, seed.name, seed.description, seed.sort_order
from company
cross join (values
  ('AI', 'AI事业部', 'AI产品、研发与交付', 10),
  ('ECOM', '电商事业部', '电商业务增长与履约', 20),
  ('OPS', '运营部', '品牌、内容与业务运营', 30),
  ('FIN', '财务部', '预算、成本、收入与资金', 40),
  ('HR', '人力资源部', '组织、人才与员工服务', 50)
) as seed(code, name, description, sort_order)
on conflict (organization_id, code) where deleted_at is null
do update set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.organization_id is null and role.code in ('owner', 'admin')
on conflict do nothing;

with matrix(role_code, permission_code) as (values
  ('department_head', 'department.manage'), ('department_head', 'project.manage'),
  ('department_head', 'task.manage'), ('department_head', 'attendance.self'),
  ('department_head', 'attendance.manage'), ('department_head', 'approval.self'),
  ('department_head', 'approval.manage'), ('department_head', 'files.manage'),
  ('employee', 'task.manage'), ('employee', 'attendance.self'),
  ('employee', 'salary.self'), ('employee', 'approval.self'), ('employee', 'files.manage'),
  ('finance', 'salary.manage'), ('finance', 'attendance.self'),
  ('finance', 'approval.self'), ('finance', 'approval.manage'), ('finance', 'files.manage'),
  ('hr', 'hr.manage'), ('hr', 'attendance.self'), ('hr', 'attendance.manage'),
  ('hr', 'salary.self'), ('hr', 'salary.manage'), ('hr', 'approval.self'),
  ('hr', 'approval.manage'), ('hr', 'files.manage')
)
insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from matrix
join public.roles role on role.code = matrix.role_code and role.organization_id is null
join public.permissions permission on permission.code = matrix.permission_code
on conflict do nothing;
```

- [ ] **Step 4: 实现仅 service_role 可调用的员工预置函数**

函数签名固定为：

```sql
create or replace function public.provision_feishu_employee(
  p_employee_no text,
  p_display_name text,
  p_department_code text,
  p_job_title text,
  p_role_code text,
  p_tenant_key text,
  p_feishu_union_id text,
  p_feishu_open_id text default null,
  p_work_email text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id bigint;
  v_department_id bigint;
  v_role_id bigint;
  v_member_id bigint;
  v_profile_id bigint;
begin
  if p_role_code not in ('owner', 'department_head', 'employee', 'finance', 'hr') then
    raise exception 'Unsupported workspace role' using errcode = '22023';
  end if;
  if nullif(btrim(p_employee_no), '') is null
     or nullif(btrim(p_display_name), '') is null
     or nullif(btrim(p_tenant_key), '') is null
     or (nullif(btrim(p_feishu_union_id), '') is null
         and nullif(btrim(p_feishu_open_id), '') is null
         and nullif(btrim(p_work_email), '') is null) then
    raise exception 'Employee identity fields are incomplete' using errcode = '22023';
  end if;

  select id into strict v_organization_id from public.organizations where slug = 'quantum-galaxy';
  select id into strict v_department_id
    from public.departments
    where organization_id = v_organization_id and code = p_department_code and deleted_at is null;
  select id into strict v_role_id
    from public.roles
    where code = p_role_code and organization_id is null and is_enabled;

  select profile.id, profile.organization_member_id
    into v_profile_id, v_member_id
    from public.employee_profiles profile
    where profile.organization_id = v_organization_id
      and profile.employee_no = btrim(p_employee_no)
      and profile.deleted_at is null;

  if v_profile_id is null then
    insert into public.organization_members (organization_id, user_id, status)
      values (v_organization_id, null, 'invited') returning id into v_member_id;
    insert into public.employee_profiles (
      organization_id, organization_member_id, employee_no, display_name,
      work_email, department_id, job_title, employment_status
    ) values (
      v_organization_id, v_member_id, btrim(p_employee_no), btrim(p_display_name),
      nullif(btrim(p_work_email), ''), v_department_id, btrim(p_job_title), 'active'
    ) returning id into v_profile_id;
  else
    update public.employee_profiles set
      display_name = btrim(p_display_name), work_email = nullif(btrim(p_work_email), ''),
      department_id = v_department_id, job_title = btrim(p_job_title)
    where id = v_profile_id;
  end if;

  delete from public.member_roles assignment
  using public.roles role
  where assignment.member_id = v_member_id
    and assignment.role_id = role.id
    and role.code in ('owner', 'department_head', 'employee', 'finance', 'hr');
  insert into public.member_roles (member_id, role_id) values (v_member_id, v_role_id);

  insert into public.external_identities (
    organization_id, organization_member_id, tenant_key,
    feishu_union_id, feishu_open_id, status
  ) values (
    v_organization_id, v_member_id, btrim(p_tenant_key),
    nullif(btrim(p_feishu_union_id), ''), nullif(btrim(p_feishu_open_id), ''), 'invited'
  )
  on conflict (provider, organization_member_id) do update set
    tenant_key = excluded.tenant_key,
    feishu_union_id = excluded.feishu_union_id,
    feishu_open_id = excluded.feishu_open_id,
    status = case when public.external_identities.status = 'revoked' then 'revoked' else 'invited' end,
    updated_at = now();

  return v_member_id;
end;
$$;
```

- [ ] **Step 5: 实现首次登录绑定和当前访问 RPC**

先增加一个仅供 `service_role` 的受控绑定函数，供本地 E2E 建立真实 Supabase Cookie，也可用于管理员修复已经核对过 union_id 的账号。它必须同时校验工号、union_id 和 `auth.users`，不能只凭 auth user UUID 绑定：

```sql
create or replace function public.bind_preprovisioned_member(
  p_employee_no text,
  p_auth_user_id uuid,
  p_feishu_union_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id bigint;
  v_external_id bigint;
begin
  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'Auth user does not exist' using errcode = '23503';
  end if;

  select profile.organization_member_id, external.id
    into strict v_member_id, v_external_id
    from public.employee_profiles profile
    join public.organizations organization on organization.id = profile.organization_id and organization.slug = 'quantum-galaxy'
    join public.external_identities external on external.organization_member_id = profile.organization_member_id
    where profile.employee_no = btrim(p_employee_no)
      and profile.deleted_at is null
      and external.feishu_union_id = btrim(p_feishu_union_id)
      and external.status <> 'revoked';

  if exists (
    select 1 from public.organization_members member
    where member.user_id = p_auth_user_id and member.id <> v_member_id
  ) then raise exception 'Auth user is already bound' using errcode = '23505'; end if;

  update public.organization_members set user_id = p_auth_user_id, status = 'active' where id = v_member_id;
  update public.external_identities
    set auth_user_id = p_auth_user_id, status = 'active', updated_at = now()
    where id = v_external_id;
end;
$$;
```

`claim_current_feishu_identity()` 必须自行读取 `auth.identities`，不得信任浏览器提交的 open_id/union_id：

```sql
create or replace function public.claim_current_feishu_identity()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_provider_user_id text;
  v_open_id text;
  v_union_id text;
  v_tenant_key text;
  v_email text;
  v_avatar_url text;
  v_external public.external_identities%rowtype;
  v_member_status text;
  v_employment_status text;
begin
  if v_auth_user_id is null then return 'unauthenticated'; end if;

  select identity.provider_id,
         coalesce(identity.identity_data ->> 'open_id', identity.provider_id),
         identity.identity_data ->> 'union_id',
         identity.identity_data ->> 'tenant_key',
         identity.identity_data ->> 'email',
         coalesce(identity.identity_data ->> 'picture', identity.identity_data ->> 'avatar_url')
    into v_provider_user_id, v_open_id, v_union_id, v_tenant_key, v_email, v_avatar_url
    from auth.identities identity
    where identity.user_id = v_auth_user_id and identity.provider = 'custom:feishu'
    order by identity.updated_at desc
    limit 1;
  if v_provider_user_id is null or v_tenant_key is null then return 'invalid_identity'; end if;

  select external.* into v_external
    from public.external_identities external
    join public.employee_profiles profile on profile.organization_member_id = external.organization_member_id and profile.deleted_at is null
    where external.provider = 'feishu'
      and external.tenant_key = v_tenant_key
      and (
        (v_union_id is not null and external.feishu_union_id = v_union_id)
        or (external.feishu_open_id = v_open_id)
        or (external.provider_user_id = v_provider_user_id)
        or (v_email is not null and lower(profile.work_email) = lower(v_email))
      )
    order by case
      when external.feishu_union_id = v_union_id then 0
      when external.feishu_open_id = v_open_id or external.provider_user_id = v_provider_user_id then 1
      else 2
    end
    limit 1
    for update;
  if v_external.id is null then return 'not_provisioned'; end if;
  if v_external.status = 'revoked' then return 'revoked'; end if;
  if v_external.auth_user_id is not null and v_external.auth_user_id <> v_auth_user_id then return 'identity_conflict'; end if;

  if exists (
    select 1 from public.organization_members member
    where member.user_id = v_auth_user_id and member.id <> v_external.organization_member_id
  ) then return 'identity_conflict'; end if;

  select member.status, profile.employment_status
    into v_member_status, v_employment_status
    from public.organization_members member
    join public.employee_profiles profile on profile.organization_member_id = member.id and profile.deleted_at is null
    where member.id = v_external.organization_member_id;
  if v_member_status is null or v_employment_status is null then return 'identity_conflict'; end if;
  if v_member_status = 'suspended' then return 'suspended'; end if;
  if v_employment_status = 'departed' then return 'departed'; end if;

  update public.organization_members
    set user_id = v_auth_user_id, status = 'active'
    where id = v_external.organization_member_id
      and (user_id is null or user_id = v_auth_user_id);
  if not found then return 'identity_conflict'; end if;

  update public.external_identities set
    provider_user_id = v_provider_user_id,
    feishu_open_id = coalesce(feishu_open_id, v_open_id),
    feishu_union_id = coalesce(feishu_union_id, v_union_id),
    auth_user_id = v_auth_user_id,
    status = 'active', last_login_at = now(), updated_at = now()
  where id = v_external.id;
  update public.employee_profiles
    set avatar_url = coalesce(nullif(v_avatar_url, ''), avatar_url)
    where organization_member_id = v_external.organization_member_id and deleted_at is null;
  return 'active';
end;
$$;
```

`current_workspace_access()` 返回当前用户自己的最小信息，不返回工资、手机号或飞书 Token：

```sql
create or replace function public.current_workspace_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'authUserId', member.user_id,
    'organizationId', organization.public_id,
    'organizationName', organization.name,
    'memberId', member.id,
    'employeeProfileId', profile.public_id,
    'memberStatus', member.status,
    'displayName', profile.display_name,
    'avatarUrl', profile.avatar_url,
    'departmentName', coalesce(department.name, '未分配部门'),
    'jobTitle', profile.job_title,
    'employmentStatus', profile.employment_status,
    'roleCodes', coalesce(array_agg(distinct role.code) filter (where role.code is not null), array[]::text[]),
    'permissionCodes', coalesce((
      select array_agg(distinct permission.code)
      from public.member_roles member_role
      join public.role_permissions role_permission on role_permission.role_id = member_role.role_id
      join public.permissions permission on permission.id = role_permission.permission_id
      where member_role.member_id = member.id
    ), array[]::text[])
  )
  from public.organization_members member
  join public.organizations organization on organization.id = member.organization_id and organization.slug = 'quantum-galaxy'
  join public.employee_profiles profile on profile.organization_member_id = member.id and profile.deleted_at is null
  left join public.departments department on department.id = profile.department_id and department.deleted_at is null
  left join public.member_roles assignment on assignment.member_id = member.id
  left join public.roles role on role.id = assignment.role_id and role.is_enabled
  where member.user_id = (select auth.uid())
    and member.status = 'active'
    and profile.employment_status in ('probation', 'active', 'on_leave')
  group by member.id, organization.id, profile.id, department.id;
$$;
```

- [ ] **Step 6: 加 RLS、授权和最小暴露边界**

```sql
alter table public.external_identities enable row level security;
alter table public.external_identities force row level security;

create policy external_identities_self_select on public.external_identities
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

revoke all on public.external_identities from public, anon, authenticated;
grant select on public.external_identities to authenticated;

revoke execute on function public.provision_feishu_employee(text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.provision_feishu_employee(text,text,text,text,text,text,text,text,text) to service_role;
revoke execute on function public.bind_preprovisioned_member(text,uuid,text) from public, anon, authenticated;
grant execute on function public.bind_preprovisioned_member(text,uuid,text) to service_role;
revoke execute on function public.claim_current_feishu_identity() from public, anon;
grant execute on function public.claim_current_feishu_identity() to authenticated;
revoke execute on function public.current_workspace_access() from public, anon;
grant execute on function public.current_workspace_access() to authenticated;
```

- [ ] **Step 7: 添加 pgTAP 权限矩阵**

`supabase/tests/phase1_identity_rbac.sql` 在回滚事务内建立五岗位、未开通、停用和离职 fixture，并逐项断言：

```sql
begin;
select plan(26);

select has_table('public', 'external_identities', 'external identities exist');
select has_function('public', 'claim_current_feishu_identity', array[]::name[], 'claim RPC exists');
select has_function('public', 'current_workspace_access', array[]::name[], 'access RPC exists');
select policies_are('public', 'external_identities', array['external_identities_self_select']);
select is((select count(*) from public.organizations where slug = 'quantum-galaxy'), 1::bigint, 'one QuantXY seed');
select is((select count(*) from public.departments department join public.organizations organization on organization.id = department.organization_id where organization.slug = 'quantum-galaxy'), 5::bigint, 'five departments seeded');

with users(id, email, open_id, union_id) as (values
  ('11000000-0000-4000-8000-000000000001'::uuid, 'owner@example.test', 'ou_owner', 'on_owner'),
  ('11000000-0000-4000-8000-000000000002'::uuid, 'manager@example.test', 'ou_manager', 'on_manager'),
  ('11000000-0000-4000-8000-000000000003'::uuid, 'employee@example.test', 'ou_employee', 'on_employee'),
  ('11000000-0000-4000-8000-000000000004'::uuid, 'finance@example.test', 'ou_finance', 'on_finance'),
  ('11000000-0000-4000-8000-000000000005'::uuid, 'hr@example.test', 'ou_hr', 'on_hr'),
  ('11000000-0000-4000-8000-000000000006'::uuid, 'unknown@example.test', 'ou_unknown', 'on_unknown'),
  ('11000000-0000-4000-8000-000000000007'::uuid, 'suspended@example.test', 'ou_suspended', 'on_suspended'),
  ('11000000-0000-4000-8000-000000000008'::uuid, 'departed@example.test', 'ou_departed', 'on_departed')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
       crypt('local-e2e-password', gen_salt('bf')), now(),
       '{"provider":"custom:feishu","providers":["custom:feishu"]}'::jsonb,
       '{}'::jsonb, now(), now()
from users;

with identities(user_id, open_id, union_id) as (values
  ('11000000-0000-4000-8000-000000000001'::uuid, 'ou_owner', 'on_owner'),
  ('11000000-0000-4000-8000-000000000002'::uuid, 'ou_manager', 'on_manager'),
  ('11000000-0000-4000-8000-000000000003'::uuid, 'ou_employee', 'on_employee'),
  ('11000000-0000-4000-8000-000000000004'::uuid, 'ou_finance', 'on_finance'),
  ('11000000-0000-4000-8000-000000000005'::uuid, 'ou_hr', 'on_hr'),
  ('11000000-0000-4000-8000-000000000006'::uuid, 'ou_unknown', 'on_unknown'),
  ('11000000-0000-4000-8000-000000000007'::uuid, 'ou_suspended', 'on_suspended'),
  ('11000000-0000-4000-8000-000000000008'::uuid, 'ou_departed', 'on_departed')
)
insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), open_id, user_id,
       jsonb_build_object('sub', open_id, 'open_id', open_id, 'union_id', union_id, 'tenant_key', 'tenant_qxy'),
       'custom:feishu', now(), now(), now()
from identities;

select public.provision_feishu_employee('QXY-OWNER', '老板测试', 'AI', 'CEO', 'owner', 'tenant_qxy', 'on_owner', 'ou_owner', null);
select public.provision_feishu_employee('QXY-MANAGER', '经理测试', 'AI', '部门负责人', 'department_head', 'tenant_qxy', 'on_manager', 'ou_manager', null);
select public.provision_feishu_employee('QXY-EMPLOYEE', '员工测试', 'AI', '员工', 'employee', 'tenant_qxy', 'on_employee', 'ou_employee', null);
select public.provision_feishu_employee('QXY-FINANCE', '财务测试', 'FIN', '财务经理', 'finance', 'tenant_qxy', 'on_finance', 'ou_finance', null);
select public.provision_feishu_employee('QXY-HR', '人事测试', 'HR', 'HRBP', 'hr', 'tenant_qxy', 'on_hr', 'ou_hr', null);
select public.provision_feishu_employee('QXY-SUSPENDED', '停用测试', 'AI', '员工', 'employee', 'tenant_qxy', 'on_suspended', 'ou_suspended', null);
select public.provision_feishu_employee('QXY-DEPARTED', '离职测试', 'AI', '员工', 'employee', 'tenant_qxy', 'on_departed', 'ou_departed', null);

update public.organization_members set status = 'suspended'
where id = (select organization_member_id from public.employee_profiles where employee_no = 'QXY-SUSPENDED');
update public.employee_profiles set employment_status = 'departed', departure_date = current_date
where employee_no = 'QXY-DEPARTED';

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select is(public.claim_current_feishu_identity(), 'active', 'owner identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'owner', 'owner role returned');
select ok(public.has_organization_role((select id from public.organizations where slug = 'quantum-galaxy'), array['owner']), 'owner passes privileged database role check');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select is(public.claim_current_feishu_identity(), 'active', 'manager identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'department_head', 'manager role returned');
select ok(public.has_organization_role((select id from public.organizations where slug = 'quantum-galaxy'), array['department_head']), 'manager passes department database role check');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
select is(public.claim_current_feishu_identity(), 'active', 'employee identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'employee', 'employee role returned');
select ok((public.current_workspace_access() -> 'permissionCodes') ? 'task.manage', 'employee scoped task permission returned');
select is(public.has_organization_role((select id from public.organizations where slug = 'quantum-galaxy'), array['owner', 'finance', 'hr']), false, 'employee fails privileged database role check');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000004', true);
select is(public.claim_current_feishu_identity(), 'active', 'finance identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'finance', 'finance role returned');
select ok(public.has_organization_role((select id from public.organizations where slug = 'quantum-galaxy'), array['finance']), 'finance passes finance database role check');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000005', true);
select is(public.claim_current_feishu_identity(), 'active', 'hr identity binds');
select ok((public.current_workspace_access() -> 'roleCodes') ? 'hr', 'hr role returned');
select ok(public.has_organization_role((select id from public.organizations where slug = 'quantum-galaxy'), array['hr']), 'hr passes hr database role check');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000006', true);
select is(public.claim_current_feishu_identity(), 'not_provisioned', 'unknown Feishu user is rejected');
select is(public.current_workspace_access(), null::jsonb, 'unknown user has no workspace access');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000007', true);
select is(public.claim_current_feishu_identity(), 'suspended', 'suspended member is rejected');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000008', true);
select is(public.claim_current_feishu_identity(), 'departed', 'departed employee is rejected');

select * from finish();
rollback;
```

- [ ] **Step 8: 运行契约测试和本地数据库测试**

先初始化本地 Supabase 配置：

Run: `npx supabase init`

Expected: 创建 `supabase/config.toml`；`project_id` 改为 `enterprise-workstation`，本地 `[auth.email] enable_signup = true` 只供 Task 8 自动化创建密码测试会话。云端项目仍按 Task 7 手册关闭邮箱密码注册。

Run:

```powershell
npx vitest run src/lib/supabase/phase1-identity-migration.test.ts
npx supabase start
npx supabase db reset
npx supabase test db
```

Expected: Vitest PASS；迁移从空库顺序执行成功；pgTAP 26/26 PASS。若 Docker 未运行，先启动 Docker Desktop，再重新执行同一命令；不得跳过数据库测试后宣称 RLS 已完成。

- [ ] **Step 9: 提交**

```bash
git add supabase/config.toml supabase/migrations/202608100001_phase1_identity_rbac.sql supabase/tests/phase1_identity_rbac.sql src/lib/supabase/phase1-identity-migration.test.ts
git commit -m "feat: add phase one identity and rbac schema"
```

---

### Task 3: 真实 WorkspaceSession 领域模型

**Mandatory amendment note:** 本任务的类型、fixture、解析器和测试必须在旧示例基础上增加 `tenantId: string`、`identity: { providerCode: string; authProvider: string; providerSubject: string }` 与 `profile.skills: string[]`。`parseWorkspaceAccess()` 缺少这些字段时返回 `null`；不得检查 `organizationName === "量子星河"` 作为租户验证，不得把 open_id、union_id 或 providerTenantKey 放进 `WorkspaceSession`。本说明优先于下方旧类型和 `base` fixture。

**Files:**
- Create: `src/features/auth/workspace-session-types.ts`
- Create: `src/features/auth/workspace-access.test.ts`
- Create: `src/features/auth/workspace-access.ts`
- Create: `src/features/auth/workspace-session.ts`
- Create: `src/features/auth/workspace-session-provider.test.tsx`
- Create: `src/features/auth/workspace-session-provider.tsx`

**Interfaces:**
- Consumes: `supabase.rpc("current_workspace_access")` 的 JSON 结果，包含 `tenantId`、`providerCode`、`authProvider`、`providerSubject` 和规范化 `skills`。
- Produces: `WorkspaceRole`、`WorkspaceActor`、`WorkspaceSession`、`parseWorkspaceAccess(value)`、`hasWorkspacePermission(session, permission)`、`getWorkspaceSession()`、`requireWorkspaceSession()`、`WorkspaceSessionProvider`、`useWorkspaceSession()`。

- [ ] **Step 1: 写五岗位和无效会话测试**

```ts
import { describe, expect, it } from "vitest";
import { parseWorkspaceAccess } from "@/features/auth/workspace-access";

const base = {
  authUserId: "10000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000002",
  organizationName: "量子星河",
  memberId: 10,
  employeeProfileId: "10000000-0000-4000-8000-000000000003",
  memberStatus: "active",
  displayName: "测试员工",
  avatarUrl: null,
  departmentName: "AI事业部",
  jobTitle: "产品经理",
  employmentStatus: "active",
  permissionCodes: ["task.manage"],
};

it.each([
  ["owner", "executive", "/dashboard"],
  ["department_head", "department_head", "/department"],
  ["employee", "employee", "/execution"],
  ["finance", "finance", "/finance"],
  ["hr", "hr", "/hr"],
] as const)("maps %s to %s", (databaseRole, role, landingPath) => {
  const session = parseWorkspaceAccess({ ...base, roleCodes: [databaseRole] });
  expect(session).toMatchObject({ primaryRole: role, landingPath });
  expect(session?.actor.name).toBe("测试员工");
});

it("rejects an active account without one business role", () => {
  expect(parseWorkspaceAccess({ ...base, roleCodes: ["admin"] })).toBeNull();
});
```

- [ ] **Step 2: 运行并确认模块不存在**

Run: `npx vitest run src/features/auth/workspace-access.test.ts`

Expected: FAIL，提示无法解析 `workspace-access`。

- [ ] **Step 3: 定义稳定类型和映射**

```ts
export type DatabaseRoleCode = "owner" | "admin" | "department_head" | "employee" | "finance" | "hr";
export type WorkspaceRole = "executive" | "department_head" | "employee" | "finance" | "hr";
export type WorkspacePermissionCode =
  | "dashboard.read" | "organization.manage" | "department.manage"
  | "project.manage" | "task.manage" | "hr.manage"
  | "attendance.self" | "attendance.manage" | "salary.self" | "salary.manage"
  | "approval.self" | "approval.manage" | "files.manage";

export type WorkspaceActor = {
  id: string;
  memberId: string;
  name: string;
  role: WorkspaceRole;
  roleLabel: string;
  department: string;
  title: string;
  landingPath: string;
};

export type WorkspaceSession = {
  authUserId: string;
  organization: { id: string; name: "量子星河" };
  member: { id: number; employeeProfileId: string; status: "active" };
  profile: { displayName: string; avatarUrl: string | null; departmentName: string; jobTitle: string };
  roleCodes: DatabaseRoleCode[];
  permissionCodes: WorkspacePermissionCode[];
  primaryRole: WorkspaceRole;
  landingPath: string;
  isAdmin: boolean;
  actor: WorkspaceActor;
};
```

`parseWorkspaceAccess` 使用固定优先级 `owner > department_head > finance > hr > employee`。兼容 actor 的 `id/memberId` 只匹配现有本地 fixture：

```ts
import type { DatabaseRoleCode, WorkspaceActor, WorkspacePermissionCode, WorkspaceRole, WorkspaceSession } from "@/features/auth/workspace-session-types";

const compatibilityIds = {
  executive: ["actor-executive", "20000000-0000-4000-8000-000000000010"],
  department_head: ["actor-manager", "20000000-0000-4000-8000-000000000001"],
  employee: ["actor-employee", "20000000-0000-4000-8000-000000000004"],
  finance: ["actor-finance", "20000000-0000-4000-8000-000000000007"],
  hr: ["actor-hr", "20000000-0000-4000-8000-000000000006"],
} as const;

const roleMapping: Record<Exclude<DatabaseRoleCode, "admin">, WorkspaceRole> = {
  owner: "executive", department_head: "department_head", employee: "employee", finance: "finance", hr: "hr",
};
const priority: Exclude<DatabaseRoleCode, "admin">[] = ["owner", "department_head", "finance", "hr", "employee"];
const labels: Record<WorkspaceRole, string> = { executive: "CEO", department_head: "管理层", employee: "普通员工", finance: "财务", hr: "人事" };
const landings: Record<WorkspaceRole, string> = { executive: "/dashboard", department_head: "/department", employee: "/execution", finance: "/finance", hr: "/hr" };
const databaseRoles = new Set<DatabaseRoleCode>(["owner", "admin", "department_head", "employee", "finance", "hr"]);
const workspacePermissions = new Set<WorkspacePermissionCode>([
  "dashboard.read", "organization.manage", "department.manage", "project.manage", "task.manage", "hr.manage",
  "attendance.self", "attendance.manage", "salary.self", "salary.manage", "approval.self", "approval.manage", "files.manage",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseWorkspaceAccess(value: unknown): WorkspaceSession | null {
  const raw = record(value);
  if (!raw || raw.organizationName !== "量子星河" || raw.memberStatus !== "active") return null;
  if (!["probation", "active", "on_leave"].includes(String(raw.employmentStatus))) return null;
  if (typeof raw.authUserId !== "string" || typeof raw.organizationId !== "string"
      || typeof raw.memberId !== "number" || typeof raw.employeeProfileId !== "string"
      || typeof raw.displayName !== "string" || typeof raw.departmentName !== "string"
      || typeof raw.jobTitle !== "string" || !Array.isArray(raw.roleCodes) || !Array.isArray(raw.permissionCodes)) return null;

  const roleCodes = raw.roleCodes.filter((code): code is DatabaseRoleCode => typeof code === "string" && databaseRoles.has(code as DatabaseRoleCode));
  const permissionCodes = raw.permissionCodes.filter((code): code is WorkspacePermissionCode => typeof code === "string" && workspacePermissions.has(code as WorkspacePermissionCode));
  const databaseRole = priority.find((role) => roleCodes.includes(role));
  if (!databaseRole) return null;
  const primaryRole = roleMapping[databaseRole];
  const [id, memberId] = compatibilityIds[primaryRole];
  const landingPath = landings[primaryRole];
  const actor: WorkspaceActor = {
    id, memberId, name: raw.displayName, role: primaryRole, roleLabel: labels[primaryRole],
    department: raw.departmentName, title: raw.jobTitle, landingPath,
  };
  return {
    authUserId: raw.authUserId,
    organization: { id: raw.organizationId, name: "量子星河" },
    member: { id: raw.memberId, employeeProfileId: raw.employeeProfileId, status: "active" },
    profile: {
      displayName: raw.displayName,
      avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : null,
      departmentName: raw.departmentName,
      jobTitle: raw.jobTitle,
    },
    roleCodes, permissionCodes, primaryRole, landingPath, isAdmin: roleCodes.includes("admin"), actor,
  };
}

export function hasWorkspacePermission(session: WorkspaceSession, permission: WorkspacePermissionCode) {
  return session.permissionCodes.includes(permission);
}
```

函数必须用真实 `displayName/departmentName/jobTitle` 填充 actor；任何服务端授权代码不得读取 `actor.id` 或 `actor.memberId`。

- [ ] **Step 4: 实现服务端会话读取**

```ts
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { parseWorkspaceAccess } from "@/features/auth/workspace-access";

export const getWorkspaceSession = cache(async () => {
  const supabase = await getSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  const { data, error } = await supabase.rpc("current_workspace_access");
  if (error) throw new Error("无法读取当前工作身份");
  return parseWorkspaceAccess(data);
});

export async function requireWorkspaceSession() {
  const supabase = await getSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");
  const session = await getWorkspaceSession();
  if (!session) redirect("/access-pending?reason=not_provisioned");
  return session;
}
```

- [ ] **Step 5: 写并实现只读客户端 Provider**

测试必须断言未包 Provider 时抛出“WorkspaceSessionProvider 缺失”，包裹后 `actor` 与真实员工姓名可读且没有 `actors`/`setActorId`。

```tsx
"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

const WorkspaceSessionContext = createContext<WorkspaceSession | null>(null);

export function WorkspaceSessionProvider({ session, children }: { session: WorkspaceSession; children: ReactNode }) {
  return <WorkspaceSessionContext.Provider value={session}>{children}</WorkspaceSessionContext.Provider>;
}

export function useWorkspaceSession() {
  const session = useContext(WorkspaceSessionContext);
  if (!session) throw new Error("WorkspaceSessionProvider 缺失");
  return session;
}
```

- [ ] **Step 6: 运行定向测试和类型检查**

Run:

```powershell
npx vitest run src/features/auth/workspace-access.test.ts src/features/auth/workspace-session-provider.test.tsx
npm run typecheck
```

Expected: 两个测试文件 PASS；类型检查退出码 0。

- [ ] **Step 7: 提交**

```bash
git add src/features/auth/workspace-session-types.ts src/features/auth/workspace-access.ts src/features/auth/workspace-access.test.ts src/features/auth/workspace-session.ts src/features/auth/workspace-session-provider.tsx src/features/auth/workspace-session-provider.test.tsx
git commit -m "feat: add real workspace session model"
```

---

### Task 4: Supabase SSR 刷新和服务端路由保护

**Files:**
- Create: `src/lib/supabase/middleware.ts`
- Create: `src/middleware.ts`
- Create: `src/features/auth/route-policy.test.ts`
- Modify: `src/lib/supabase/server.ts`
- Modify: `src/features/operations/role-access.ts`
- Modify: `src/features/operations/role-access.test.ts`

**Interfaces:**
- Consumes: `WorkspaceRole`、`parseWorkspaceAccess()`、`canRoleAccessPath()`、Supabase Cookie。
- Produces: `updateSupabaseSession(request)`、`middleware(request)`；未登录到 `/login`，未开通到 `/access-pending`，越权到岗位首页。

- [ ] **Step 1: 写公开路径和岗位路由失败测试**

```ts
import { describe, expect, it } from "vitest";
import { isPublicAuthPath } from "@/features/auth/workspace-access";
import { canRoleAccessPath } from "@/features/operations/role-access";

it.each(["/login", "/auth/callback", "/access-pending", "/api/auth/feishu/userinfo"])("keeps %s public", (path) => {
  expect(isPublicAuthPath(path)).toBe(true);
});

it("keeps role destinations server-checkable", () => {
  expect(canRoleAccessPath("executive", "/dashboard")).toBe(true);
  expect(canRoleAccessPath("executive", "/hr")).toBe(false);
  expect(canRoleAccessPath("employee", "/execution")).toBe(true);
  expect(canRoleAccessPath("employee", "/people")).toBe(false);
});
```

- [ ] **Step 2: 运行并确认公开路径函数不存在**

Run: `npx vitest run src/features/auth/route-policy.test.ts src/features/operations/role-access.test.ts`

Expected: FAIL，提示 `isPublicAuthPath` 未导出或 `DemoRole` 类型不匹配。

- [ ] **Step 3: 实现 Request/Response Cookie 刷新客户端**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = getSupabaseEnv();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  return { response, supabase, subject: typeof data?.claims?.sub === "string" ? data.claims.sub : null };
}
```

- [ ] **Step 4: 实现路由保护**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { isPublicAuthPath, parseWorkspaceAccess } from "@/features/auth/workspace-access";
import { canRoleAccessPath } from "@/features/operations/role-access";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

function redirectWithRefreshedCookies(response: NextResponse, destination: URL) {
  const redirect = NextResponse.redirect(destination);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const { response, supabase, subject } = await updateSupabaseSession(request);
  if (isPublicAuthPath(pathname)) return response;
  if (!subject) return redirectWithRefreshedCookies(response, new URL("/login", request.url));

  const { data, error } = await supabase.rpc("current_workspace_access");
  const session = error ? null : parseWorkspaceAccess(data);
  if (!session) return redirectWithRefreshedCookies(response, new URL("/access-pending?reason=not_provisioned", request.url));
  if (!canRoleAccessPath(session.primaryRole, pathname)) {
    return redirectWithRefreshedCookies(response, new URL(`${session.landingPath}?notice=no_access`, request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

公开路径函数只允许精确前缀，不得使用任意 `startsWith('/api')`：

```ts
export function isPublicAuthPath(pathname: string) {
  return pathname === "/login"
    || pathname === "/access-pending"
    || pathname.startsWith("/auth/callback")
    || pathname === "/api/auth/feishu/userinfo";
}
```

- [ ] **Step 5: 清理 Server Component 客户端注释并验证**

保留 `src/lib/supabase/server.ts` 的异步 `cookies()` 和 `setAll` try/catch；将“未来 auth proxy”注释改为“Middleware 负责刷新，Server Component 只读取”。不得改用 `getSession()` 做授权。

Run:

```powershell
npx vitest run src/features/auth/route-policy.test.ts src/features/operations/role-access.test.ts
npm run typecheck
```

Expected: PASS，类型检查退出码 0。

- [ ] **Step 6: 提交**

```bash
git add src/lib/supabase/middleware.ts src/middleware.ts src/lib/supabase/server.ts src/features/auth/route-policy.test.ts src/features/operations/role-access.ts src/features/operations/role-access.test.ts
git commit -m "feat: protect workspace routes with supabase auth"
```

---

### Task 5: 飞书登录、回调、退出和状态页面

**Mandatory amendment note:** 新建 `oauth-provider-registry.ts` 和对应测试，定义通用 `OAuthProviderDefinition { code, label, supabaseProvider, enabled, loginButtonLabel }`；Registry 当前只有 `{ code: "feishu", supabaseProvider: "custom:feishu", enabled: true }`。Server Action 固定通过 `signInWithOAuthProvider("feishu")`/Registry 查找后调用 Supabase，未知或停用 Provider 返回稳定错误；`signInWithFeishu()` 可保留为 UI 薄包装。登录页仍只有“使用飞书登录”一个主按钮，不显示 Provider 选择器。回调必须调用通用 `claim_current_identity()`，不能调用 `claim_current_feishu_identity()`。本说明优先于下方旧 Action/回调示例。

**Files:**
- Create: `src/features/auth/oauth-provider-registry.ts`
- Create: `src/features/auth/oauth-provider-registry.test.ts`
- Create: `src/features/auth/actions.ts`
- Create: `src/features/auth/login-card.tsx`
- Create: `src/features/auth/login-card.test.tsx`
- Create: `src/app/login/page.tsx`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/app/auth/callback/route.test.ts`
- Create: `src/app/access-pending/page.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `getSupabaseServerClient()`、`getAuthEnv()`、OAuth Provider Registry、`claim_current_identity()`、`current_workspace_access()`。
- Produces: `getEnabledOAuthProvider(code)`、`signInWithOAuthProvider(code)`、飞书 UI 薄包装 `signInWithFeishu()`、`signOut()`、`/login`、`GET /auth/callback`、`/access-pending`。

- [ ] **Step 1: 写登录卡片失败测试**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LoginCard } from "@/features/auth/login-card";

it("shows one clear Feishu login action", () => {
  render(<LoginCard action={vi.fn()} errorCode={null} />);
  expect(screen.getByRole("heading", { name: "登录 AI企业大脑" })).toBeVisible();
  expect(screen.getByRole("button", { name: "使用飞书登录" })).toBeVisible();
  expect(screen.queryByLabelText(/邮箱|密码/)).not.toBeInTheDocument();
  expect(screen.getByText("仅限量子星河内部员工使用")).toBeVisible();
});
```

- [ ] **Step 2: 运行并确认组件不存在**

Run: `npx vitest run src/features/auth/login-card.test.tsx`

Expected: FAIL，提示无法解析 `login-card`。

- [ ] **Step 3: 实现发起登录和退出 Server Actions**

```ts
"use server";
import { redirect } from "next/navigation";
import { getAuthEnv } from "@/features/auth/auth-env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function signInWithFeishu() {
  const supabase = await getSupabaseServerClient();
  const { appUrl } = getAuthEnv();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "custom:feishu",
    options: { redirectTo: `${appUrl}/auth/callback` },
  });
  if (error || !data.url) redirect("/login?error=login_unavailable");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?status=signed_out");
}
```

- [ ] **Step 4: 实现登录和状态页**

`LoginCard` 只渲染一个 `<form action={action}>` 主按钮；错误码映射固定为：

```ts
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

const loginMessages: Record<string, string> = {
  login_unavailable: "登录服务暂时不可用，请稍后重试。",
  callback_failed: "登录没有完成，请重新尝试。",
};

export function LoginCard({ action, errorCode }: {
  action: () => Promise<void>;
  errorCode: string | null;
}) {
  return (
    <GlassCard className="w-full max-w-md p-7 sm:p-9">
      <Image src="/brand/quantxy-mark.png" alt="量子星河 QuantXY" width={573} height={381} className="mx-auto h-16 w-24 object-contain" priority />
      <div className="mt-5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">登录 AI企业大脑</h1>
        <p className="mt-2 text-sm text-muted-foreground">仅限量子星河内部员工使用</p>
      </div>
      {errorCode && loginMessages[errorCode] ? <p role="alert" className="mt-5 rounded-xl bg-destructive/8 p-3 text-sm text-destructive">{loginMessages[errorCode]}</p> : null}
      <form action={action} className="mt-6">
        <Button type="submit" size="lg" className="w-full">使用飞书登录</Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted-foreground">登录即表示使用你的企业飞书身份进入对应岗位工作台。</p>
    </GlassCard>
  );
}
```

`src/app/login/page.tsx` 在服务端处理已登录跳转，页面只有这一张卡片：

```tsx
import { redirect } from "next/navigation";
import { signInWithFeishu } from "@/features/auth/actions";
import { LoginCard } from "@/features/auth/login-card";
import { getWorkspaceSession } from "@/features/auth/workspace-session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getWorkspaceSession();
  if (session) redirect(session.landingPath);
  const { error } = await searchParams;
  return <main className="workspace-mesh grid min-h-screen place-items-center px-4 py-10"><LoginCard action={signInWithFeishu} errorCode={error ?? null} /></main>;
}
```

`/access-pending` 的 reason 文案固定为：

```ts
const accessMessages = {
  not_provisioned: "你的飞书账号尚未开通企业工作站，请联系管理员。",
  suspended: "你的工作站账号已暂停，请联系人事或管理员。",
  departed: "该员工账号已停用，无法进入工作站。",
  identity_conflict: "账号绑定异常，请联系管理员处理。",
} as const;
```

页面不得显示数据库错误、飞书 open_id、union_id、tenant_key 或请求 Token。

`src/app/access-pending/page.tsx` 从 `searchParams.reason` 读取白名单文案，未知值使用 `identity_conflict`，并只提供“返回登录”链接；不得提供自助创建账号按钮。

- [ ] **Step 5: 写回调编排测试**

```ts
it("binds a provisioned identity and redirects to its role landing page", async () => {
  const response = await handleAuthCallback(new Request("https://brain.quantxy.com/auth/callback?code=one-time-code"), {
    exchangeCode: async () => true,
    claimIdentity: async () => "active",
    loadSession: async () => ({ landingPath: "/execution" }),
    signOut: async () => undefined,
  });
  expect(response.headers.get("location")).toBe("https://brain.quantxy.com/execution");
});

it.each(["not_provisioned", "suspended", "departed", "identity_conflict"])("signs out rejected identity: %s", async (reason) => {
  const signOut = vi.fn(async () => undefined);
  const response = await handleAuthCallback(new Request("https://brain.quantxy.com/auth/callback?code=one-time-code"), {
    exchangeCode: async () => true, claimIdentity: async () => reason,
    loadSession: async () => null, signOut,
  });
  expect(signOut).toHaveBeenCalledOnce();
  expect(response.headers.get("location")).toContain(`/access-pending?reason=${reason}`);
});
```

- [ ] **Step 6: 实现回调 Route Handler**

将编排函数导出供测试，并让 `GET` 注入真实依赖。允许暴露给员工的 reason 使用固定白名单，数据库返回的其他字符串统一映射为 `identity_conflict`：

```ts
type PublicAccessReason = "not_provisioned" | "suspended" | "departed" | "identity_conflict";
type AuthCallbackDependencies = {
  exchangeCode: (code: string) => Promise<boolean>;
  claimIdentity: () => Promise<string | null>;
  loadSession: () => Promise<{ landingPath: string } | null>;
  signOut: () => Promise<void>;
};

const publicReasons = new Set<PublicAccessReason>(["not_provisioned", "suspended", "departed", "identity_conflict"]);

function publicReason(value: string | null): PublicAccessReason {
  return value && publicReasons.has(value as PublicAccessReason)
    ? value as PublicAccessReason
    : "identity_conflict";
}

export async function handleAuthCallback(request: Request, dependencies: AuthCallbackDependencies) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(new URL("/login?error=callback_failed", url.origin));

  if (!await dependencies.exchangeCode(code)) {
    return Response.redirect(new URL("/login?error=callback_failed", url.origin));
  }

  const claimResult = await dependencies.claimIdentity();
  if (claimResult !== "active") {
    await dependencies.signOut();
    return Response.redirect(new URL(`/access-pending?reason=${publicReason(claimResult)}`, url.origin));
  }
  const session = await dependencies.loadSession();
  if (!session) {
    await dependencies.signOut();
    return Response.redirect(new URL("/access-pending?reason=identity_conflict", url.origin));
  }
  return Response.redirect(new URL(session.landingPath, url.origin));
}

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient();
  return handleAuthCallback(request, {
    exchangeCode: async (code) => !(await supabase.auth.exchangeCodeForSession(code)).error,
    claimIdentity: async () => {
      const { data, error } = await supabase.rpc("claim_current_feishu_identity");
      return error || typeof data !== "string" ? null : data;
    },
    loadSession: getWorkspaceSession,
    signOut: async () => { await supabase.auth.signOut({ scope: "local" }); },
  });
}
```

- [ ] **Step 7: 更新根路由和品牌元数据**

`src/app/page.tsx` 调用 `getWorkspaceSession()`：有会话跳岗位首页，无会话跳 `/login`。`src/app/layout.tsx` 标题改为“量子星河 AI企业大脑”，描述改为“把经营目标转成可执行项目、任务与结果的企业内部工作系统”。

- [ ] **Step 8: 运行认证页面测试、类型检查和无障碍检查**

Run:

```powershell
npx vitest run src/features/auth/login-card.test.tsx src/app/auth/callback/route.test.ts
npm run typecheck
npm run lint
```

Expected: 全部 PASS；登录页没有邮箱/密码输入；Lint 退出码 0。

- [ ] **Step 9: 提交**

```bash
git add src/features/auth/actions.ts src/features/auth/login-card.tsx src/features/auth/login-card.test.tsx src/app/login/page.tsx src/app/auth/callback/route.ts src/app/auth/callback/route.test.ts src/app/access-pending/page.tsx src/app/page.tsx src/app/layout.tsx
git commit -m "feat: add feishu login and account states"
```

---

### Task 6: 用真实会话替换 DemoSession，保留业务兼容投影

**Files:**
- Modify: `src/app/(workspace)/layout.tsx`
- Modify: `src/components/shell/workspace-shell.tsx`
- Modify: `src/components/shell/workspace-header.tsx`
- Modify: `src/components/shell/app-sidebar.tsx`
- Modify: `src/components/shell/mobile-workspace-nav.tsx`
- Modify: `src/components/shell/role-access-guard.tsx`
- Modify: `src/components/shell/workspace-search-dialog.tsx`
- Modify: `src/components/shell/workspace-shell.test.tsx`
- Modify: `src/config/navigation.ts`
- Modify: `src/features/operations/operations-types.ts`
- Modify: `src/features/operations/operations-data.ts`
- Modify: all business consumer files listed in the File Map
- Delete: `src/features/operations/demo-session.tsx`

**Interfaces:**
- Consumes: `WorkspaceSession`、`WorkspaceSessionProvider`、`useWorkspaceSession()`、`signOut()`。
- Produces: 真实姓名/头像/岗位 Shell；零 `useDemoSession`、零演示身份切换、零 `OPERATIONS_ACTOR_KEY`。

- [ ] **Step 1: 先修改 Shell 测试为真实会话 fixture**

```tsx
const executiveSession: WorkspaceSession = {
  authUserId: "10000000-0000-4000-8000-000000000001",
  organization: { id: "10000000-0000-4000-8000-000000000002", name: "量子星河" },
  member: { id: 10, employeeProfileId: "10000000-0000-4000-8000-000000000003", status: "active" },
  profile: { displayName: "张星河", avatarUrl: null, departmentName: "总经办", jobTitle: "CEO" },
  roleCodes: ["owner"], permissionCodes: ["dashboard.read", "organization.manage"], primaryRole: "executive", landingPath: "/dashboard", isAdmin: false,
  actor: { id: "actor-executive", memberId: "20000000-0000-4000-8000-000000000010", name: "张星河", role: "executive", roleLabel: "CEO", department: "总经办", title: "CEO", landingPath: "/dashboard" },
};

render(<WorkspaceShell session={executiveSession}><p>驾驶舱内容</p></WorkspaceShell>);
expect(screen.getByText("张星河")).toBeVisible();
expect(screen.getByText("CEO · CEO")).toBeVisible();
expect(screen.queryByText("切换演示身份")).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "退出登录" })).toBeVisible();
```

- [ ] **Step 2: 运行测试并确认 props 不匹配**

Run: `npx vitest run src/components/shell/workspace-shell.test.tsx`

Expected: FAIL，`WorkspaceShell` 不接受 `session` 或 Header 仍显示演示身份。

- [ ] **Step 3: 让 Workspace Layout 和 Shell 注入真实会话**

```tsx
export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireWorkspaceSession();
  return <WorkspaceShell session={session}>{children}</WorkspaceShell>;
}

export function WorkspaceShell({ children, session }: { children: ReactNode; session: WorkspaceSession }) {
  return (
    <WorkspaceSessionProvider session={session}>
      <RoleAccessGuard>
        <div className="workspace-mesh min-h-screen">
          <div className="fixed inset-y-0 left-0 z-50 hidden lg:block">
            <WorkspaceSidebar />
          </div>
          <div className="min-h-screen lg:pl-56">
            <WorkspaceHeader />
            <div id="main-content">{children}</div>
          </div>
        </div>
      </RoleAccessGuard>
    </WorkspaceSessionProvider>
  );
}
```

- [ ] **Step 4: 移除 Header 演示身份切换**

Header 改用：

```tsx
const { actor, profile } = useWorkspaceSession();
```

头像优先显示 `profile.avatarUrl`，姓名显示 `profile.displayName`，副标题显示 `${actor.roleLabel} · ${profile.jobTitle}`。删除 `actors`、`setActorId`、`Check` 图标、`demoMessage` 状态和“本地试用版说明” Dialog。退出项必须调用 Server Action：

```tsx
<form action={signOut}>
  <DropdownMenuItem asChild variant="destructive">
    <button type="submit" className="w-full"><LogOut aria-hidden="true" />退出登录</button>
  </DropdownMenuItem>
</form>
```

- [ ] **Step 5: 机械替换所有 Consumer**

对 File Map 中每个文件执行两项机械修改：

```ts
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
const { actor } = useWorkspaceSession();
```

不得在此步骤改项目、任务、审批、考勤或薪资业务逻辑。`src/features/operations/operations-types.ts` 从 `workspace-session-types.ts` 导入 `WorkspaceRole` 和 `WorkspaceActor`；`navigation.ts`、`role-access.ts` 改用 `WorkspaceRole`。

- [ ] **Step 6: 删除浏览器身份存储**

删除 `src/features/operations/demo-session.tsx`；从 `operations-data.ts` 删除：

```ts
OPERATIONS_ACTOR_KEY
OPERATIONS_ACTOR_CHANGED_EVENT
```

保留业务 fixture `demoActors` 时改名为 `operationFixtureActors`，只供第一阶段本地业务数据映射使用，不再导出身份切换 API。

- [ ] **Step 7: 扫描禁止残留**

Run:

```powershell
rg -n "useDemoSession|DemoSessionProvider|OPERATIONS_ACTOR_KEY|切换演示身份|enterprise-workspace.demo-actor" src
```

Expected: 无输出，退出码 1（表示没有匹配）；不得用注释隐藏残留。

- [ ] **Step 8: 运行 Shell、角色和完整单元回归**

Run:

```powershell
npx vitest run src/components/shell/workspace-shell.test.tsx src/features/operations/role-access.test.ts
npm test
npm run typecheck
```

Expected: 定向测试 PASS；完整测试 45 个既有文件加新增文件全部 PASS；类型检查退出码 0。若某个既有测试直接渲染 Consumer，使用 `WorkspaceSessionProvider` 和明确 fixture 包裹，不得恢复 Context 默认演示用户。

- [ ] **Step 9: 提交**

```bash
git add src/app/(workspace)/layout.tsx src/components/shell src/config/navigation.ts src/features
git rm src/features/operations/demo-session.tsx
git commit -m "refactor: replace demo identity with workspace session"
```

---

### Task 7: 员工名单预置工具和云端配置手册

**Mandatory amendment note:** 名单根级固定包含 `tenantSlug: "quantxy"`、`organizationSlug: "quantum-galaxy"` 和 `providerCode: "feishu"`；每名员工可含 `skills: string[]`。脚本把 `feishuUnionId/openId/workEmail` 转换为通用 `providerSubject/providerMatchKeys`，调用 `provision_employee_identity`，不得把飞书字段直接变成数据库核心合同。校验复用 Task 2 的技能规则（最多 30 项、每项 1–40 字符、trim/lower/deduplicate）并拒绝非启用租户/Provider。手册必须说明 `FEISHU_TENANT_KEY` 是 Provider 租户标识，不是应用 `tenant_id`；当前只配置量子星河，但数据库已具备未来 SaaS 隔离边界。本说明优先于下方旧名单和 RPC 示例。

**Files:**
- Create: `scripts/phase1/provision-roster.test.mjs`
- Create: `scripts/phase1/provision-roster.mjs`
- Create: `docs/deployment/phase1-supabase-feishu.md`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `PHASE1_ROSTER_PATH` 指向的租户/组织/Provider 通用本地 JSON、`NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。
- Produces: `validateRoster(payload)`、飞书字段到通用身份匹配键的映射、幂等调用 `provision_employee_identity` 的 CLI、可由非技术管理员照做的配置清单。

- [ ] **Step 1: 写名单校验失败测试**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { validateRoster } from "./provision-roster.mjs";

test("accepts five supported business roles", () => {
  const roles = ["owner", "department_head", "employee", "finance", "hr"];
  const records = roles.map((roleCode, index) => ({
    employeeNo: `QXY-${index + 1}`, displayName: `员工${index + 1}`,
    departmentCode: roleCode === "finance" ? "FIN" : roleCode === "hr" ? "HR" : "AI",
    jobTitle: "测试岗位", roleCode, tenantKey: "tenant_qxy",
    feishuUnionId: `on_${index + 1}`, feishuOpenId: `ou_${index + 1}`,
  }));
  assert.equal(validateRoster(records).length, 5);
});

test("rejects duplicates and unsupported roles", () => {
  assert.throws(() => validateRoster([
    { employeeNo: "QXY-1", displayName: "甲", departmentCode: "AI", jobTitle: "员工", roleCode: "admin", tenantKey: "tenant", feishuUnionId: "on_same" },
    { employeeNo: "QXY-2", displayName: "乙", departmentCode: "AI", jobTitle: "员工", roleCode: "employee", tenantKey: "tenant", feishuUnionId: "on_same" },
  ]), /名单数据不合法/);
});
```

- [ ] **Step 2: 运行并确认脚本不存在**

Run: `node --test scripts/phase1/provision-roster.test.mjs`

Expected: FAIL，提示无法找到 `provision-roster.mjs`。

- [ ] **Step 3: 实现校验和导入**

```js
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const allowedRoles = new Set(["owner", "department_head", "employee", "finance", "hr"]);
const allowedDepartments = new Set(["AI", "ECOM", "OPS", "FIN", "HR"]);

export function validateRoster(records) {
  if (!Array.isArray(records) || records.length === 0) throw new Error("名单数据不合法：没有员工记录");
  const employeeNos = new Set();
  const unionIds = new Set();
  return records.map((record, index) => {
    const required = ["employeeNo", "displayName", "departmentCode", "jobTitle", "roleCode", "tenantKey"];
    if (required.some((key) => typeof record[key] !== "string" || !record[key].trim())) throw new Error(`名单数据不合法：第 ${index + 1} 行缺字段`);
    if (!allowedRoles.has(record.roleCode) || !allowedDepartments.has(record.departmentCode)) throw new Error(`名单数据不合法：第 ${index + 1} 行角色或部门错误`);
    const unionId = typeof record.feishuUnionId === "string" && record.feishuUnionId.trim() ? record.feishuUnionId.trim() : null;
    const openId = typeof record.feishuOpenId === "string" && record.feishuOpenId.trim() ? record.feishuOpenId.trim() : null;
    const workEmail = typeof record.workEmail === "string" && record.workEmail.trim() ? record.workEmail.trim().toLowerCase() : null;
    if (!unionId && !openId && !workEmail) throw new Error(`名单数据不合法：第 ${index + 1} 行没有可绑定的飞书标识或企业邮箱`);
    if (employeeNos.has(record.employeeNo) || (unionId && unionIds.has(unionId))) throw new Error(`名单数据不合法：第 ${index + 1} 行标识重复`);
    employeeNos.add(record.employeeNo); if (unionId) unionIds.add(unionId);
    return { ...record, workEmail, feishuUnionId: unionId, feishuOpenId: openId };
  });
}

export async function provisionRoster(env = process.env) {
  const path = env.PHASE1_ROSTER_PATH;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!path || !url || !serviceRole) throw new Error("名单导入配置缺失");
  const records = validateRoster(JSON.parse(await readFile(path, "utf8")));
  const supabase = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const record of records) {
    const { error } = await supabase.rpc("provision_feishu_employee", {
      p_employee_no: record.employeeNo, p_display_name: record.displayName,
      p_department_code: record.departmentCode, p_job_title: record.jobTitle,
      p_role_code: record.roleCode, p_tenant_key: record.tenantKey,
      p_feishu_union_id: record.feishuUnionId, p_feishu_open_id: record.feishuOpenId,
      p_work_email: record.workEmail,
    });
    if (error) throw new Error(`员工 ${record.employeeNo} 预置失败：${error.code}`);
  }
  return records.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  provisionRoster().then((count) => console.log(`已预置 ${count} 名员工`)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
```

- [ ] **Step 4: 忽略真实名单并增加命令**

先把全局 E2E setup 直接使用的环境加载包加入开发依赖：

Run: `npm install --save-dev @next/env@15.5.22`

Expected: `package.json` 和 `package-lock.json` 更新，安装退出码 0。

`.gitignore` 增加：

```gitignore
/private/
/playwright/.auth/
```

`package.json` 增加：

```json
"db:start": "npx supabase start",
"db:reset": "npx supabase db reset",
"db:test": "npx supabase test db",
"phase1:provision": "node scripts/phase1/provision-roster.mjs",
"phase1:verify": "npm test && npm run typecheck && npm run lint && npm run build"
```

- [ ] **Step 5: 写云端配置手册**

手册必须按以下顺序给出可勾选步骤和结果，不要求用户理解协议细节：

1. 在 Supabase 创建 Singapore、Pro 项目，关闭邮箱密码注册和匿名登录，记录项目 URL、publishable key、service_role。
2. 在飞书开放平台创建量子星河企业自建应用，启用网页应用登录，申请基础身份权限；如果员工名单暂时没有 union_id/open_id，再申请企业邮箱字段权限，用唯一工作邮箱完成首次匹配。获取 App ID、App Secret 和 tenant_key。
3. 真实云端联调时，`NEXT_PUBLIC_APP_URL` 必须是 Supabase 能访问的 HTTPS 地址，不能是 `127.0.0.1`；阶段一可使用受控的临时 HTTPS 测试域名指向本机 3000 端口，第四阶段再换成香港正式域名。在 Supabase Auth 新建 OAuth2 Provider：identifier=`custom:feishu`，Authorization URL=`https://accounts.feishu.cn/open-apis/authen/v1/authorize`，Token URL=`https://open.feishu.cn/open-apis/authen/v2/oauth/token`，UserInfo URL=`${NEXT_PUBLIC_APP_URL}/api/auth/feishu/userinfo`，`email_optional=true`，`pkce_enabled=true`。
4. 将 Supabase 页面显示的只读 Callback URL登记到飞书；将 `${NEXT_PUBLIC_APP_URL}/auth/callback` 登记到 Supabase Redirect URLs。
5. 若真实联调明确返回飞书“不支持 code_challenge/code_verifier”的错误，保留错误截图和时间后，只对 `custom:feishu` 设置 `pkce_enabled=false`；没有该证据不得关闭 PKCE。
6. 执行迁移、准备 `private/phase1-roster.json`、运行 `npm run phase1:provision`；名单包含工号、姓名、部门代码、职位、角色、tenant_key，并至少提供 union_id、open_id、唯一工作邮箱三者之一，不包含密码或 Token。
7. 用五名真实飞书员工分别验证 CEO、管理层、普通员工、财务、人事首页；未知员工、停用员工、离职员工必须被拒绝。
8. 检查 Auth 日志只记录结果和请求编号，不复制 provider token、App Secret 或 service_role。

- [ ] **Step 6: 运行脚本测试并做泄密扫描**

Run:

```powershell
node --test scripts/phase1/provision-roster.test.mjs
rg -n "SUPABASE_SERVICE_ROLE_KEY|FEISHU_APP_SECRET|user_access_token" src --glob "!**/*.test.*"
```

Expected: 脚本测试 PASS；源代码只允许读取 `SUPABASE_SERVICE_ROLE_KEY` 的运维脚本存在于 `scripts/`，`src/` 无 service_role 或 App Secret 引用，且无 Token 常量。

- [ ] **Step 7: 提交**

```bash
git add .gitignore package.json package-lock.json scripts/phase1 docs/deployment/phase1-supabase-feishu.md
git commit -m "chore: add phase one provisioning runbook"
```

---

### Task 8: 自动化认证状态、五岗位 E2E 和真实联调

**Mandatory amendment note:** 自动化除五岗位外，必须建立第二测试租户与第二测试 Provider，验证跨租户路由/数据访问被拒绝且另一个 Provider 无需改变 `WorkspaceSession` 合同；认证状态调用 `provision_employee_identity` 和 `bind_preprovisioned_identity`。数据库测试同时验证 `audit_logs` 的身份认领记录、owner/admin 当前租户可读、employee/另一租户不可读、客户端直写和 update/delete 失败。若本机无 Docker/Podman，这些数据库/E2E 前置步骤明确记录为环境阻塞，不能以静态测试代替；真实页面仍只联调飞书。本说明优先于下方旧 Feishu-only fixture/RPC 示例。

**Files:**
- Create: `tests/e2e/auth-state.ts`
- Create: `tests/e2e/global-setup.ts`
- Create: `tests/e2e/phase1-auth-rbac.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/dashboard.spec.ts`: 将过期的“早上好，李总”断言改为当前 Dashboard 标题和 E2E CEO 姓名。

**Interfaces:**
- Consumes: 本地 Supabase URL、publishable key、service_role、本地测试用户；使用 `@supabase/ssr` 捕获真实 Auth Cookie。
- Produces: `authStatePath(role)`、`prepareAuthStates(env?)`；Playwright 默认 executive storageState；五岗位独立 browser context。

- [ ] **Step 1: 写未登录和岗位访问 E2E**

```ts
import { expect, test } from "@playwright/test";
import { authStatePath } from "./auth-state";

test("未登录员工只能看到飞书登录", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "使用飞书登录" })).toBeVisible();
  await context.close();
});

for (const [role, landing, forbidden] of [
  ["executive", "/dashboard", "/hr"],
  ["department_head", "/department", "/finance"],
  ["employee", "/execution", "/people"],
  ["finance", "/finance", "/dashboard"],
  ["hr", "/hr", "/analytics"],
] as const) {
  test(`${role} 进入自己的岗位首页并被拒绝越权`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: authStatePath(role) });
    const page = await context.newPage();
    await page.goto(landing);
    await expect(page).toHaveURL(new RegExp(`${landing}$`));
    await page.goto(forbidden);
    await expect(page).toHaveURL(new RegExp(`${landing}\\?notice=no_access$`));
    await context.close();
  });
}
```

- [ ] **Step 2: 运行并确认认证状态工具不存在**

Run: `npx playwright test tests/e2e/phase1-auth-rbac.spec.ts --workers=1`

Expected: FAIL，提示无法解析 `auth-state` 或状态文件不存在。

- [ ] **Step 3: 实现真实本地 Supabase Cookie 状态**

`tests/e2e/auth-state.ts` 使用 service_role 只在本地 Supabase 创建五个 `@example.test` 用户，调用正式预置/绑定 RPC，再使用普通 publishable key 捕获真实 SSR Cookie。完整实现骨架为：

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { WorkspaceRole } from "../../src/features/auth/workspace-session-types";

const password = "Local-E2E-Only-2026!";
const fixtures = {
  executive: { employeeNo: "E2E-OWNER", roleCode: "owner", departmentCode: "AI", unionId: "on_e2e_owner" },
  department_head: { employeeNo: "E2E-MANAGER", roleCode: "department_head", departmentCode: "AI", unionId: "on_e2e_manager" },
  employee: { employeeNo: "E2E-EMPLOYEE", roleCode: "employee", departmentCode: "AI", unionId: "on_e2e_employee" },
  finance: { employeeNo: "E2E-FINANCE", roleCode: "finance", departmentCode: "FIN", unionId: "on_e2e_finance" },
  hr: { employeeNo: "E2E-HR", roleCode: "hr", departmentCode: "HR", unionId: "on_e2e_hr" },
} as const;

export function authStatePath(role: WorkspaceRole) {
  return path.resolve("playwright", ".auth", `${role}.json`);
}

async function findOrCreateUser(admin: ReturnType<typeof createClient>, email: string) {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const existing = listed.data.users.find((user) => user.email === email);
  if (existing) {
    const updated = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    if (updated.error) throw updated.error;
    return existing.id;
  }
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("E2E user was not created");
  return created.data.user.id;
}

async function writeSignedInState(url: string, publishableKey: string, role: WorkspaceRole, email: string) {
const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
const client = createServerClient(url, publishableKey, {
  cookies: {
    getAll: () => [...jar].map(([name, item]) => ({ name, value: item.value })),
    setAll: (items) => items.forEach(({ name, value, options }) => jar.set(name, { value, options })),
  },
});
const { error } = await client.auth.signInWithPassword({ email, password });
if (error) throw error;
  await mkdir(path.dirname(authStatePath(role)), { recursive: true });
  await writeFile(authStatePath(role), JSON.stringify({
    cookies: [...jar].map(([name, item]) => ({
      name, value: item.value, domain: "127.0.0.1", path: "/", expires: -1,
      httpOnly: true, secure: false, sameSite: "Lax",
    })),
    origins: [],
  }, null, 2));
}

export async function prepareAuthStates(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  const tenantKey = env.FEISHU_TENANT_KEY ?? "tenant_local_e2e";
  if (!url || !publishableKey || !serviceRole) throw new Error("E2E Supabase 配置缺失");
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(url).hostname)) throw new Error("E2E 只允许本地 Supabase");

  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const [role, fixture] of Object.entries(fixtures) as [WorkspaceRole, typeof fixtures[WorkspaceRole]][]) {
    const email = `${role}@example.test`;
    const authUserId = await findOrCreateUser(admin, email);
    const provisioned = await admin.rpc("provision_feishu_employee", {
      p_employee_no: fixture.employeeNo, p_display_name: `E2E ${role}`,
      p_department_code: fixture.departmentCode, p_job_title: "自动化测试岗位",
      p_role_code: fixture.roleCode, p_tenant_key: tenantKey,
      p_feishu_union_id: fixture.unionId, p_feishu_open_id: `ou_${role}`, p_work_email: email,
    });
    if (provisioned.error) throw provisioned.error;
    const bound = await admin.rpc("bind_preprovisioned_member", {
      p_employee_no: fixture.employeeNo, p_auth_user_id: authUserId, p_feishu_union_id: fixture.unionId,
    });
    if (bound.error) throw bound.error;
    await writeSignedInState(url, publishableKey, role, email);
  }
}
```

- [ ] **Step 4: 接入 Playwright setup**

`tests/e2e/global-setup.ts`：

```ts
import { loadEnvConfig } from "@next/env";
import { prepareAuthStates } from "./auth-state";

export default async function globalSetup() {
  loadEnvConfig(process.cwd());
  await prepareAuthStates();
}
```

`playwright.config.ts` 增加：

```ts
globalSetup: "./tests/e2e/global-setup.ts",
use: {
  baseURL: "http://127.0.0.1:3000",
  channel: "chrome",
  storageState: authStatePath("executive"),
  trace: "retain-on-failure",
  screenshot: "only-on-failure",
},
webServer: {
  command: "npm run dev -- --hostname 127.0.0.1",
  url: "http://127.0.0.1:3000/login",
  reuseExistingServer: false,
  timeout: 120_000,
},
```

配置文件从 `./tests/e2e/auth-state` 导入 `authStatePath`。这样现有 chrome project 默认使用 executive 状态，五岗位专项测试自行选择状态；不得伪造 JWT、不得向生产代码添加测试旁路。

- [ ] **Step 5: 运行认证专项和完整 E2E**

Run:

```powershell
npx supabase status
npx playwright test tests/e2e/phase1-auth-rbac.spec.ts --workers=1
npm run test:e2e
```

Expected: 认证专项 6 个场景 PASS；完整 E2E PASS。若旧 Dashboard 文案断言仍检查“早上好，李总”，将其更新为当前真实标题和测试员工姓名，不改变页面实现去迎合旧断言。

- [ ] **Step 6: 真实飞书联调**

按手册使用五名真实员工完成以下验收并记录日期、岗位、结果，不保存授权码或 Token：

- CEO 登录后进入 `/dashboard`。
- 管理层登录后进入 `/department`。
- 普通员工登录后进入 `/execution`。
- 财务登录后进入 `/finance`。
- 人事登录后进入 `/hr`。
- 未在名单中的飞书员工进入 `/access-pending?reason=not_provisioned`。
- 将一名测试成员设为 `suspended` 后重新登录，被拒绝进入。
- 退出登录后直接访问任一工作台，返回 `/login`。

若尚未取得飞书 App 凭据或真实五岗位名单，本步骤是唯一允许标记为外部阻塞的验收项；自动化和本地 RLS 测试仍必须先完成，且不得用假账号写入正式库代替。

- [ ] **Step 7: 提交**

```bash
git add playwright.config.ts tests/e2e
git commit -m "test: verify phase one auth and role access"
```

---

### Task 9: 全量验证、运行恢复和阶段一交付

**Mandatory amendment note:** 最终交付必须单独输出四部分：`数据库迁移结果`、`页面变化`、`测试结果`、`下一阶段建议`。数据库部分区分静态合同通过、本地 reset/pgTAP 是否因 Docker 阻塞、云端是否实际执行；不得把未运行写成通过。页面部分只报告登录/用户/权限/组织身份变化。测试部分列出实际命令与通过/阻塞数量。下一阶段只建议项目、任务、文件和业务审计迁移；第一阶段不得创建 `/agents`、Agent 表、Agent UI、AI 匹配、Dify 或 n8n 代码。

**Files:**
- Modify: `docs/deployment/phase1-supabase-feishu.md` only if verification reveals a command correction.

**Interfaces:**
- Consumes: Tasks 1–8 全部提交。
- Produces: 可重复验证证据、3007 生产预览恢复、阶段一完成/外部阻塞清单。

- [ ] **Step 1: 做禁止项扫描**

Run:

```powershell
rg -n "useDemoSession|DemoSessionProvider|OPERATIONS_ACTOR_KEY|enterprise-workspace.demo-actor" src
rg -n "SUPABASE_SERVICE_ROLE_KEY|FEISHU_APP_SECRET" src
rg -n "localStorage|indexedDB" src/features/auth src/lib/supabase src/app/login src/app/auth src/middleware.ts
```

Expected: 三组命令均无输出。业务功能目录仍存在的 localStorage/IndexedDB 属于第二阶段迁移，不得在第一阶段仓促删除。

- [ ] **Step 2: 运行完整质量门**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npx supabase db reset
npx supabase test db
npm run test:e2e
git diff --check
```

Expected: 非数据库命令退出码 0；构建包含 `/login`、`/auth/callback`、`/access-pending`、`/api/auth/feishu/userinfo` 和现有全部工作台路由。`supabase db reset`、pgTAP 与依赖本地 Supabase 的 E2E 只有在 Docker/Podman 或受控开发数据库可用时才运行；当前环境不可用时记录 `NOT RUN — ENVIRONMENT BLOCKED`，不得写成通过。

- [ ] **Step 3: 检查依赖安全但不擅自升级大版本**

Run: `npm audit --omit=dev`

Expected: 记录当前 Next 15 依赖链的报告。不得在本计划中自动升级 Next 16；将需要大版本升级才能修复的项目写入单独安全升级任务，避免与认证迁移混在一个提交。

- [ ] **Step 4: 恢复 3007 生产预览**

先读取 3007 监听 PID 和命令行，只停止工作目录确认为 `E:\新企业工作站` 的 `next start` 进程；随后从刚通过的构建启动：

```powershell
npm run start -- --hostname 127.0.0.1 --port 3007
```

Expected: `http://127.0.0.1:3007/login` 返回 200；无会话访问 `/dashboard` 跳到 `/login`；不得停止其他项目的 Node 进程。

- [ ] **Step 5: 浏览器验收简洁易用性**

在 1440px 桌面和 390px 移动视口检查：

- 登录页只有“使用飞书登录”一个主按钮。
- 未开通/停用页面只说明原因和联系人，不显示技术术语。
- Header 显示真实员工姓名、岗位和头像，不存在身份切换。
- 各岗位只看到自己的导航；直接输入越权 URL 自动回岗位首页并显示简短提示。
- 当前项目、任务等页面仍可浏览，且明确标注其真实数据迁移在第二阶段继续。

- [ ] **Step 6: 最终提交和状态确认**

若验证没有产生代码变化，不创建空提交。若仅修正文档命令：

```bash
git add docs/deployment/phase1-supabase-feishu.md
git commit -m "docs: finalize phase one verification"
```

Run: `git status --short --branch`

Expected: 工作树干净；分支只包含本计划列出的阶段一提交。只有当自动化、数据库、构建、E2E 和真实飞书五岗位联调全部通过时，才能宣称“阶段一完成”；缺少飞书凭据或名单时必须明确写“代码完成，真实联调待企业资料”。

---

## Phase 1 Acceptance Matrix

| 场景 | 前端结果 | 服务端结果 | 数据库结果 |
|---|---|---|---|
| 未登录 | 看到飞书登录页 | Middleware 拒绝工作台 | 无 authenticated 访问 |
| 未开通飞书员工 | 显示联系管理员 | 回调退出会话 | 无 organization member 读取 |
| 停用/离职员工 | 显示账号状态 | 回调或 Middleware 拒绝 | RLS 的 active member 条件失败 |
| CEO | 进入老板驾驶舱 | 只接受 owner 主岗位 | owner RLS/角色函数通过 |
| 管理层 | 进入负责人推进台 | 越权跳回 `/department` | department_head 策略通过 |
| 普通员工 | 进入我的执行台 | 越权跳回 `/execution` | 只能通过本人/分配相关策略 |
| 财务 | 进入财务执行中心 | 越权跳回 `/finance` | finance 策略通过 |
| 人事 | 进入人事协同中心 | 越权跳回 `/hr` | hr 策略通过 |
| 退出登录 | 返回登录页 | Supabase local session 清除 | 后续请求没有 auth.uid() |
| 跨租户引用/访问 | 不提供租户切换入口 | 会话只携带当前 tenantId | 组合 FK/守卫和 tenant-first RLS 拒绝 |
| 新增 OAuth Provider 合同 | V1 仍只显示飞书 | Registry 可新增 Provider 定义 | 通用预置/认领/会话合同无需改表 |
| 身份/权限操作审计 | 第一阶段不新增复杂日志页面 | 受控函数追加净化事件 | audit_logs 当前租户只读、客户端直写和修改拒绝 |
| 员工技能标签 | 员工资料可携带简洁标签 | 会话返回规范化 skills | 默认空、最多 30 项、每项 1–40 字符 |

## Implementation References

- [Supabase Custom OAuth/OIDC Providers](https://supabase.com/docs/guides/auth/custom-oauth-providers): `custom:` identifier、OAuth2 三端点、`email_optional` 和 PKCE 配置。
- [Supabase SSR client for Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework): Cookie 客户端、Middleware 刷新和 `getClaims()` 页面保护。
- [Supabase Identities](https://supabase.com/docs/guides/auth/identities): `provider_id`、`identity_data` 和 OAuth identity 字段语义。
- [飞书获取授权码](https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code): 网页授权入口、授权码时效和回调要求。
- [飞书获取登录用户信息](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/authen/user_info): `open_id`、`union_id`、`tenant_key`、姓名和头像字段。

## Final Self-Review Checklist

- [ ] 总设计阶段一的 Supabase、企业 OAuth 登录、用户、权限、组织身份、租户边界、身份审计、路由保护和 RLS 均能指向具体任务。
- [ ] `custom:feishu`、`email_optional=true`、PKCE 默认开启、飞书租户限制和 UserInfo Adapter 均有实现与测试；预置、认领和会话合同不绑定飞书。
- [ ] `tenants` 和所有身份/RBAC/审计表的 `tenant_id`、组合约束、tenant-first RLS 及第二测试租户均有测试。
- [ ] `audit_logs` tenant-scoped、append-only、敏感 metadata 拒绝且客户端无直接写权限。
- [ ] `employee_profiles.skills` 默认空数组、规范化、数量/长度限制已测试，且没有任何 AI 匹配实现。
- [ ] 未开通、停用、离职、身份冲突和退出均有稳定用户文案与自动化测试。
- [ ] 五岗位数据库代码、界面岗位、岗位首页和路由矩阵名称一致。
- [ ] `WorkspaceSession.actor` 被明确限制为第一阶段业务 fixture 兼容，不参与正式授权。
- [ ] 所有现有 `useDemoSession` Consumer 已在 File Map 列出，扫描验收为零。
- [ ] 真实名单、service_role、App Secret 和 Token 均不进入 Git 或浏览器。
- [ ] 当前业务页面内容完善没有被取消，已明确进入第二至第四阶段。
- [ ] 最终交付按数据库迁移结果、页面变化、测试结果、下一阶段建议四部分输出，并如实列出 Docker/云端验证缺口。
- [ ] 所有实现步骤都给出实际内容，并为失败分支写明可验证结果。
- [ ] 每个任务都有定向测试、预期失败、最小实现、通过命令和独立提交。
