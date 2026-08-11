# Phase2.5 Real Feishu OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在无公网业务域名的本机环境中完成真实飞书 OAuth 闭环，把首个真实飞书身份安全开通为量子星河 CEO，并验证员工 workspace、tenant 隔离和 RBAC。

**Architecture:** 使用 Supabase `custom:feishu` 处理 OAuth 和会话，使用 Supabase Edge Function 把飞书非标准 UserInfo 响应适配为通用 claims。数据库通过一次性、service-role-only 的 tenant bootstrap 函数锁定已预置的 `quantxy` tenant 并创建首个 owner；后续身份继续走通用预开通、认领、WorkspaceSession 和 RLS。

**Tech Stack:** Next.js 15、React 19、Supabase Auth、Supabase Edge Functions、PostgreSQL 17、pgTAP、Vitest、Node Test Runner、TypeScript

## Global Constraints

- 当前只服务“量子星河”，`quantxy` tenant 由 migration 唯一预置；CEO bootstrap 不得创建重复 tenant。
- OAuth Provider 核心合同保持通用，飞书专用逻辑只存在于 Provider Registry、UserInfo Adapter 和部署配置。
- App Secret 只填写到 Supabase Custom Provider，不进入代码、`.env.local`、日志、文档或 Git。
- `SUPABASE_SERVICE_ROLE_KEY` 只能用于本地管理员命令和 Edge Function 内部租户锁读取，不发送到浏览器。
- 未开通身份不得进入任何 workspace；Auth 用户存在不等于拥有业务权限。
- 所有 SQL fixture 在事务中回滚；除真实 CEO 身份和对应审计外，不向远程业务表写入测试数据。
- PKCE 默认开启，没有飞书明确不支持的脱敏证据不得关闭。
- 暂不开发 Agent、Dify、LangGraph、n8n 或任何 Agent 页面。
- 真实第二员工账号不存在时，自动化员工 workspace/RBAC 可以通过，但验收报告必须把真实员工 OAuth 标记为外部账号阻塞。

---

### Task 1: 建立可远程访问的飞书 UserInfo Adapter

**Files:**
- Create: `supabase/functions/feishu-userinfo/identity.mjs`
- Create: `supabase/functions/feishu-userinfo/handler.mjs`
- Create: `supabase/functions/feishu-userinfo/index.ts`
- Create: `scripts/phase2.5/feishu-userinfo.test.mjs`
- Modify: `supabase/config.toml`
- Modify: `package.json`

**Interfaces:**
- Consumes: 飞书 Bearer `user_access_token`、飞书 `GET /open-apis/authen/v1/user_info`、数据库当前 `identity_providers.provider_tenant_key`。
- Produces: `normalizeFeishuIdentity(body, tenantLock)`、`createFeishuUserInfoHandler(dependencies)`、公网 HTTPS Edge Function `feishu-userinfo`。

- [ ] **Step 1: 写身份规范化失败测试**

在 `scripts/phase2.5/feishu-userinfo.test.mjs` 使用 Node Test Runner 验证：

```js
test("returns generic claims for one Feishu identity", () => {
  assert.deepEqual(normalizeFeishuIdentity({
    code: 0,
    data: {
      tenant_key: "tenant_quantxy",
      open_id: "ou_owner",
      union_id: "on_owner",
      name: "量子星河负责人",
      avatar_url: "https://example.invalid/avatar.png",
    },
  }, "tenant_quantxy"), {
    sub: "open_id:ou_owner",
    provider_subject: "open_id:ou_owner",
    provider_tenant_key: "tenant_quantxy",
    provider_match_keys: ["open_id:ou_owner", "union_id:on_owner"],
    name: "量子星河负责人",
    picture: "https://example.invalid/avatar.png",
    open_id: "ou_owner",
    union_id: "on_owner",
    tenant_key: "tenant_quantxy",
  });
});

test("rejects another tenant after the provider is locked", () => {
  assert.throws(
    () => normalizeFeishuIdentity(validBody("other_tenant"), "tenant_quantxy"),
    /wrong_feishu_tenant/,
  );
});
```

同时验证缺少 `tenant_key`、姓名或主体标识时失败，异常邮箱被忽略，错误响应不回显 Token 或完整上游 body。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test scripts/phase2.5/feishu-userinfo.test.mjs`

Expected: FAIL，提示 `identity.mjs` 或导出函数不存在。

- [ ] **Step 3: 实现纯身份规范化模块**

`identity.mjs` 固定导出：

```js
export function normalizeFeishuIdentity(body, tenantLock = null) {
  if (body?.code !== 0 || !body.data) throw new Error("invalid_feishu_response");
  const tenantKey = requiredText(body.data.tenant_key, "invalid_feishu_identity");
  if (tenantLock && tenantLock !== tenantKey) throw new Error("wrong_feishu_tenant");
  const name = requiredText(body.data.name, "invalid_feishu_identity");
  const claims = buildProviderIdentityClaims({
    openId: body.data.open_id,
    unionId: body.data.union_id,
    email: body.data.email,
    emailVerified: body.data.email_verified !== false,
    ignoreInvalidEmail: true,
  });
  return toPublicClaims(claims, tenantKey, name, body.data.avatar_url);
}
```

`requiredText`、`buildProviderIdentityClaims` 和 `toPublicClaims` 在同文件内完整实现，限制 match key 最长 200 字符，不输出手机号或未验证邮箱。

- [ ] **Step 4: 写 HTTP handler 失败测试**

验证：只允许 GET；无 Bearer、超长 Header、非法 Token 为 401；飞书 401 为 401；飞书超时/5xx 为 502；成功返回 `Cache-Control: private, no-store`；函数调用 `loadTenantLock()` 后再规范化身份。

- [ ] **Step 5: 运行 handler 测试并确认按预期失败**

Run: `node --test scripts/phase2.5/feishu-userinfo.test.mjs`

Expected: FAIL，提示 `createFeishuUserInfoHandler` 不存在。

- [ ] **Step 6: 实现 handler 和 Edge 入口**

`handler.mjs` 导出 `createFeishuUserInfoHandler({ fetchImpl, loadTenantLock })`。入口 `index.ts`：

```ts
import { createFeishuUserInfoHandler } from "./handler.mjs";

const handler = createFeishuUserInfoHandler({
  fetchImpl: fetch,
  loadTenantLock: async () => loadFeishuTenantLock({
    url: Deno.env.get("SUPABASE_URL") ?? "",
    serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  }),
});

Deno.serve(handler);
```

`loadFeishuTenantLock` 只读取 `provider_code=feishu` 的唯一启用 Provider。值仍以 `tenant_key_from_` 开头时返回 `null` 进入一次性 bootstrap 状态；真实值存在后必须精确匹配。

在 `supabase/config.toml` 添加：

```toml
[functions.feishu-userinfo]
verify_jwt = false
```

原因是入口收到的是飞书 `user_access_token`，不是 Supabase JWT；Token 真实性由飞书 UserInfo API 验证。

- [ ] **Step 7: 运行 Edge 测试**

Run: `node --test scripts/phase2.5/feishu-userinfo.test.mjs`

Expected: 全部 PASS，输出不包含 fixture Token。

- [ ] **Step 8: 提交 Edge Function**

```powershell
git add supabase/functions/feishu-userinfo supabase/config.toml scripts/phase2.5/feishu-userinfo.test.mjs package.json
git commit -m "feat: add secure feishu userinfo edge adapter"
```

### Task 2: 建立 CEO 首次登录 tenant bootstrap

**Files:**
- Create: `supabase/migrations/202608110001_feishu_first_owner_bootstrap.sql`
- Create: `supabase/tests/phase2_5_feishu_oauth.sql`
- Create: `scripts/phase2.5/bootstrap-migration-contract.test.mjs`

**Interfaces:**
- Consumes: 一个真实 `auth.users` 与其唯一 `custom:feishu` identity，已预置 `quantxy / quantum-galaxy`，零组织成员状态。
- Produces: `public.bootstrap_first_owner_from_auth_identity(p_auth_user_id uuid, p_employee_no text, p_department_code text, p_job_title text, p_skills text[]) returns bigint`。

- [ ] **Step 1: 写 migration 合同失败测试**

`bootstrap-migration-contract.test.mjs` 读取 SQL 并验证：函数只接受固定参数；包含 `tenant.slug = 'quantxy'` 和 `organization.slug = 'quantum-galaxy'`；检查 tenant count、member count 和唯一 custom provider identity；锁定 provider tenant key；调用通用 provision/bind；写审计；最终 revoke/grant：

```js
assert.match(sql, /revoke all on function public\.bootstrap_first_owner_from_auth_identity[\s\S]*from public, anon, authenticated/i);
assert.match(sql, /grant execute on function public\.bootstrap_first_owner_from_auth_identity[\s\S]*to service_role/i);
assert.doesNotMatch(sql, /insert\s+into\s+public\.tenants/i);
```

- [ ] **Step 2: 运行合同测试并确认按预期失败**

Run: `node --test scripts/phase2.5/bootstrap-migration-contract.test.mjs`

Expected: FAIL，migration 文件不存在。

- [ ] **Step 3: 实现 service-role-only bootstrap 函数**

函数在一个事务内完成：

```sql
select count(*), min(id) into v_tenant_count, v_tenant_id
from public.tenants where slug = 'quantxy' and status = 'active';
if v_tenant_count <> 1 then raise exception 'Bootstrap tenant is not unique'; end if;

select count(*) into v_member_count
from public.organization_members where tenant_id = v_tenant_id;
if v_member_count <> 0 then raise exception 'Bootstrap is already complete'; end if;

select identity.identity_data, identity.provider_id
into strict v_identity_data, v_auth_provider_subject
from auth.identities identity
where identity.user_id = p_auth_user_id
  and identity.provider = 'custom:feishu';
```

随后从 identity data 规范化 provider subject、match keys、tenant key 和 display name；把唯一 `feishu` Provider 的 placeholder tenant key 更新为真实值；调用 `provision_employee_identity(... role_code => 'owner' ...)` 和 `bind_preprovisioned_identity(...)`；确认 `tenants` 数量仍为 1；追加 `tenant.bootstrap_owner` 审计事件。

函数使用 advisory transaction lock 防止并发首次开通，拒绝空身份、多个 identity、已有成员、非 placeholder tenant、tenant 冲突和重复 Auth 绑定。

- [ ] **Step 4: 写 pgTAP tenant bootstrap/RBAC 测试**

`phase2_5_feishu_oauth.sql` 在事务中创建一个 Auth 用户和 `custom:feishu` identity，调用 bootstrap 后断言：

- `quantxy` tenant 仍恰好 1 条。
- organization member 恰好 1 条，状态 active。
- employee profile、external identity 和 owner role 各 1 条。
- `current_workspace_access()` 对 owner 返回 `/dashboard` 所需角色与权限。
- 再次 bootstrap 失败。
- 第二个 tenant identity bootstrap 失败。
- 审计存在 `tenant.bootstrap_owner`。

同一事务继续创建 employee、department_head、finance、hr fixture，验证 `current_workspace_access()` 和 RLS 允许/拒绝矩阵，最后 `rollback`。

- [ ] **Step 5: 运行本地合同测试**

Run: `node --test scripts/phase2.5/bootstrap-migration-contract.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交 bootstrap migration**

```powershell
git add supabase/migrations/202608110001_feishu_first_owner_bootstrap.sql supabase/tests/phase2_5_feishu_oauth.sql scripts/phase2.5/bootstrap-migration-contract.test.mjs
git commit -m "feat: add one-time owner tenant bootstrap"
```

### Task 3: 建立安全的本地 owner 开通命令

**Files:**
- Create: `scripts/phase2.5/bootstrap-first-owner.mjs`
- Create: `scripts/phase2.5/bootstrap-first-owner.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Supabase URL、service role、一个真实且未绑定的 `custom:feishu` Auth identity。
- Produces: `findBootstrapCandidate(users, externalIdentities)`、`bootstrapFirstOwner(env, dependencies, { dryRun })` 和两个命令 `phase2.5:bootstrap:check` / `phase2.5:bootstrap`。

- [ ] **Step 1: 写候选选择失败测试**

测试零候选、多候选、错误 Provider、已绑定 identity、缺 tenant key 和敏感字段输出；单候选只返回内部 ID，不打印 open_id/union_id/tenant_key。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test scripts/phase2.5/bootstrap-first-owner.test.mjs`

Expected: FAIL，脚本不存在。

- [ ] **Step 3: 实现 dry-run 和执行模式**

固定 owner 资料：

```js
const FIRST_OWNER = Object.freeze({
  employeeNo: "QXY-CEO-001",
  departmentCode: "AI",
  jobTitle: "创始人 / CEO",
  skills: ["strategy", "leadership"],
});
```

`dryRun` 只输出：`已找到 1 个待开通飞书身份；量子星河当前成员 0 人；可执行 CEO 开通。`。执行模式调用 RPC 后重新读取 tenant/member/role/audit 数量，任何不一致返回非零退出码。

- [ ] **Step 4: 增加 package scripts**

```json
"phase2.5:test": "node --test scripts/phase2.5/*.test.mjs",
"phase2.5:bootstrap:check": "node scripts/phase2.5/bootstrap-first-owner.mjs --dry-run",
"phase2.5:bootstrap": "node scripts/phase2.5/bootstrap-first-owner.mjs --execute"
```

- [ ] **Step 5: 运行命令测试**

Run: `npm run phase2.5:test`

Expected: PASS，不连接远程项目，不输出 fixture Secret 或完整身份标识。

- [ ] **Step 6: 提交本地 bootstrap 命令**

```powershell
git add scripts/phase2.5/bootstrap-first-owner.mjs scripts/phase2.5/bootstrap-first-owner.test.mjs package.json
git commit -m "feat: add guarded first owner bootstrap command"
```

### Task 4: 补齐真实登录 return path 和配置校验

**Files:**
- Modify: `src/features/auth/actions.ts`
- Modify: `src/features/auth/actions.test.ts`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/login/page.test.tsx`
- Modify: `src/features/auth/auth-env.ts`
- Modify: `src/features/auth/auth-env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `next` 查询参数、`getSafeReturnPath()`、`NEXT_PUBLIC_APP_URL=http://localhost:3000`。
- Produces: `signInWithOAuthProvider(code, returnPath)`，其 `redirectTo` 为唯一允许的本机 callback，并可携带安全 `next`。

- [ ] **Step 1: 写 Server Action 失败测试**

用依赖注入验证：安全 `/finance?tab=month` 生成 `http://localhost:3000/auth/callback?next=%2Ffinance%3Ftab%3Dmonth`；外部 URL、`//evil`、重复编码和 callback 自身均不进入 redirectTo。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm test -- src/features/auth/actions.test.ts --maxWorkers=1`

Expected: FAIL，当前 action 不接受 return path。

- [ ] **Step 3: 实现 return path 传递**

登录页从 search params 读取 `next`，使用绑定后的 Server Action；Action 只通过 `getSafeReturnPath` 和 `isPublicAuthPath` 接受内部 workspace 地址，再用 `URL`/`URLSearchParams` 生成 callback，禁止字符串拼接外部 origin。

- [ ] **Step 4: 收紧环境配置**

`getAuthEnv` 继续允许开发环境 `http://localhost:3000`，拒绝带路径、查询、hash 或凭证的 app URL；远程正式环境只允许 HTTPS。`.env.example` 明确本机 Phase2.5 值和生产替换规则。

- [ ] **Step 5: 运行认证测试**

Run: `npm test -- src/features/auth/actions.test.ts src/app/login/page.test.tsx src/app/auth/callback/route.test.ts src/features/auth/auth-env.test.ts --maxWorkers=1`

Expected: 全部 PASS。

- [ ] **Step 6: 提交登录闭环修复**

```powershell
git add src/features/auth/actions.ts src/features/auth/actions.test.ts src/app/login/page.tsx src/app/login/page.test.tsx src/features/auth/auth-env.ts src/features/auth/auth-env.test.ts .env.example
git commit -m "feat: complete oauth callback return flow"
```

### Task 5: 部署 Edge Function 并配置真实飞书/Supabase OAuth

**Files:**
- Modify locally, ignored: `.env.local`
- No tracked secret files

**Interfaces:**
- Consumes: 用户在浏览器中保密输入的飞书 App Secret、可见 App ID、Supabase 项目权限。
- Produces: 已部署 Edge Function、已启用 `custom:feishu`、一致的飞书/Supabase 回调配置、已发布飞书应用版本。

- [ ] **Step 1: 配置本机非敏感环境**

把 `.env.local` 中 `NEXT_PUBLIC_APP_URL` 设置为 `http://localhost:3000`；保留已有 Supabase 配置，不把 App Secret 写入本地文件。

- [ ] **Step 2: 验证 Supabase CLI 身份并部署函数**

Run:

```powershell
npx supabase login
npx supabase functions deploy feishu-userinfo --project-ref ihqlrnmrpufmuecxsgzr --no-verify-jwt
```

Expected: 部署成功；无 Bearer 请求函数返回 401；日志不含环境变量。

- [ ] **Step 3: 创建 Supabase Custom Provider**

在保存前向用户确认。用户本人把 App Secret 输入 Supabase，Codex 不读取、不复制、不输出。按设计文档填写 OAuth2 手工配置，开启 `email_optional` 和 PKCE，UserInfo URL 使用已部署 Function URL。

- [ ] **Step 4: 配置 Supabase URL 和登录方式**

设置 Site URL/Redirect URL 为本机 3000 callback；禁用 Email、Phone、Anonymous 和 Manual Linking；保留 User Signups 供 OAuth 创建 Auth identity。每次保存后重新读取页面确认最终状态。

- [ ] **Step 5: 配置飞书回调并发布**

把 Supabase Provider 显示的只读 Callback URL添加到飞书安全设置。确认网页应用主页为本机 3000。创建版本和发布属于外部状态改变，点击最终提交前再次向用户确认。

- [ ] **Step 6: 验证公开配置**

检查 `/auth/v1/settings`、Edge Function 401 边界、Supabase Provider 状态和飞书应用已上线；不得读取或打印 Secret。

### Task 6: 执行真实 CEO OAuth 和 tenant bootstrap

**Files:**
- No tracked file changes before acceptance report

**Interfaces:**
- Consumes: 用户当前飞书账号、真实 OAuth Provider、已部署 bootstrap migration。
- Produces: 一个真实 CEO owner 身份、锁定的飞书 tenant key、完整审计链。

- [ ] **Step 1: dry-run 并推送 migration**

Run:

```powershell
npm run phase2:dry-run
npm run phase2:push
npm run phase2:check
```

Expected: 只新增 `202608110001`，不包含 seed。

- [ ] **Step 2: 运行远程 pgTAP/RBAC**

优先运行 Supabase CLI pgTAP；本机 Docker 不可用时，使用临时 `pg` 客户端在远程事务中执行同一 SQL 并确认 `rollback`，报告必须写明执行方式。

- [ ] **Step 3: 第一次真实飞书登录**

从 `http://localhost:3000/login` 发起飞书登录。Expected: OAuth 成功创建唯一 Auth identity，但业务回调显示“账号尚未开通”，工作台不可访问。

- [ ] **Step 4: 检查并执行 owner bootstrap**

Run:

```powershell
npm run phase2.5:bootstrap:check
npm run phase2.5:bootstrap
```

Expected: tenant 数量仍为 1，member/profile/external identity 各新增 1，owner role 1，审计存在。

- [ ] **Step 5: 第二次真实飞书登录**

Expected: 回调成功，进入 `/dashboard`；刷新保持会话；退出后访问 `/dashboard` 返回 `/login`。

- [ ] **Step 6: 验证未知身份拒绝**

若存在第二真实飞书账号，先不预置并验证到达 `not_provisioned`。若没有，使用远程事务 fixture 验证拒绝，并在报告单独记录真实账号阻塞。

### Task 7: 验证员工 workspace、RBAC 并生成 Phase2.5 报告

**Files:**
- Create: `docs/phase2.5-feishu-oauth-acceptance.md`

**Interfaces:**
- Consumes: 自动化、远程 pgTAP、真实 CEO OAuth 和数据库脱敏计数。
- Produces: Phase2.5 验收报告。

- [ ] **Step 1: 运行员工 workspace/RBAC 矩阵**

远程事务测试必须验证：

| 角色 | 首页 | 必须允许 | 必须拒绝 |
| --- | --- | --- | --- |
| owner | `/dashboard` | 全部 Phase1 权限 | 其他 tenant |
| department_head | `/department` | 部门、项目、任务 | HR、薪资管理 |
| employee | `/execution` | 自己的任务、文件、自助权限 | 组织、HR、薪资管理 |
| finance | `/finance` | 薪资管理、审批 | HR 管理 |
| hr | `/hr` | HR、考勤、薪资 | 其他 tenant |

- [ ] **Step 2: 运行全量回归**

Run:

```powershell
npm run phase2.5:test
npm test -- --maxWorkers=1
npm run typecheck
npm run lint
npm run build
npm run phase2:check
npm run phase2:verify
```

Expected: 所有命令退出 0；业务数据只有真实 CEO 身份和审计，不含 fixture。

- [ ] **Step 3: 写脱敏验收报告**

报告固定包含：

- OAuth Provider 与回调状态，不含 Client ID 全值或 Secret。
- Edge Function 部署与 401 边界。
- CEO 第一次登录、tenant bootstrap、第二次登录和退出结果。
- tenant 数量、真实成员数量、owner 角色和审计数量。
- employee workspace 与五角色 RBAC 矩阵。
- 真实员工 OAuth 是否因缺少第二账号阻塞。
- 自动化、远程 SQL、构建结果。
- 下一阶段建议，且明确 Agent 未开发。

- [ ] **Step 4: 检查报告不含敏感信息**

Run:

```powershell
rg -n "client_secret|app_secret|access_token|refresh_token|authorization_code|service_role|postgresql://|open_id:|union_id:|tenant_key:" docs/phase2.5-feishu-oauth-acceptance.md
```

Expected: 无匹配。

- [ ] **Step 5: 提交验收报告**

```powershell
git add docs/phase2.5-feishu-oauth-acceptance.md
git commit -m "docs: record phase2.5 feishu oauth acceptance"
```

## Plan Self-Review

- 需求覆盖：真实 OAuth 闭环由 Tasks 1、4、5、6；CEO tenant bootstrap 由 Tasks 2、3、6；员工 workspace 和 RBAC 由 Tasks 2、6、7；Agent 明确排除；Phase2.5 报告由 Task 7。
- 安全覆盖：Secret 只进 Supabase 表单，未知 Auth 身份无业务权限，bootstrap 单次且 service-role-only，tenant 不重复，SQL fixture 回滚。
- 类型一致：`normalizeFeishuIdentity`、`createFeishuUserInfoHandler`、`bootstrap_first_owner_from_auth_identity`、`bootstrapFirstOwner` 在生产与测试任务中命名一致。
- 执行方式：用户已要求继续完成，采用 Inline Execution；不调度子代理。
