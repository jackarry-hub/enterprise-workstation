# Supabase 远程初始化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 安全连接量子星河 Supabase 项目，预演并执行仓库已有 migration，验证企业身份、RBAC、技能字段、审计日志和零业务数据初始化结果。

**Architecture:** 使用 `.env.local` 保存浏览器公开配置、服务端 Secret Key 和 PostgreSQL Direct Connection String。Node 脚本负责环境变量验证、脱敏输出、Supabase CLI 调用和 Data API 结果核验；migration 始终先 dry-run，再正式 push，随后运行现有远程 pgTAP 测试。

**Tech Stack:** Node.js ESM、`@next/env`、`@supabase/supabase-js`、Supabase CLI 2.113.0、Node Test Runner、PostgreSQL 17、pgTAP

## Global Constraints

- 不创建重复的 `public.users`；使用 `auth.users`、`organization_members` 和 `employee_profiles`。
- `SUPABASE_SERVICE_ROLE_KEY` 与 `SUPABASE_DB_URL` 只能保存在本地 `.env.local`，不得写入 Git、日志或报告。
- 不使用 `supabase db push --include-seed`，不导入项目、任务、客户、考勤、审批或薪资记录。
- 允许 migration 写入量子星河租户、组织、部门、身份 Provider、角色、权限和角色权限关系等必要系统配置。
- dry-run、migration 历史或连接验证失败时立即停止，不强制修复远程 migration 历史，不删除远程数据。
- 最终报告只显示配置状态、数量和脱敏项目标识。

## File Structure

- Modify: `.env.example` — 记录四项 Supabase 配置及安全边界。
- Create: `scripts/phase2/remote-config.mjs` — 加载、验证和脱敏远程配置。
- Create: `scripts/phase2/remote-config.test.mjs` — 环境变量安全测试。
- Create: `scripts/phase2/supabase-command.mjs` — 生成并执行固定白名单的 Supabase CLI 命令。
- Create: `scripts/phase2/supabase-command.test.mjs` — CLI 参数和失败停止测试。
- Create: `scripts/phase2/verify-remote.mjs` — 验证 Data API、系统数据和零业务数据。
- Create: `scripts/phase2/verify-remote.test.mjs` — 远程验证逻辑的纯函数测试。
- Modify: `package.json` — 增加 Phase2 配置检查、预演、执行、pgTAP 和验证命令。
- Create locally, ignored: `.env.local` — 用户在本机填写真实密钥。
- Create after execution: `docs/phase2-supabase-initialization-result.md` — 脱敏初始化结果。

---

### Task 1: 建立安全的远程配置契约

**Files:**
- Modify: `.env.example`
- Create: `scripts/phase2/remote-config.test.mjs`
- Create: `scripts/phase2/remote-config.mjs`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_DB_URL`。
- Produces: `validateRemoteConfig(env): RemoteConfig`、`loadRemoteConfig(cwd): RemoteConfig`、`summarizeRemoteConfig(config): SafeSummary`。

- [ ] **Step 1: 写失败测试**

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeRemoteConfig,
  validateRemoteConfig,
} from "./remote-config.mjs";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcxyz.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_server_only",
  SUPABASE_DB_URL: "postgresql://postgres:password@db.abcxyz.supabase.co:5432/postgres",
};

test("accepts a complete hosted Supabase configuration", () => {
  assert.equal(validateRemoteConfig(valid).projectRef, "abcxyz");
});

test("rejects missing server-only settings without echoing values", () => {
  assert.throws(
    () => validateRemoteConfig({ ...valid, SUPABASE_DB_URL: "" }),
    /SUPABASE_DB_URL/,
  );
});

test("rejects a secret key placed in the public key field", () => {
  assert.throws(
    () => validateRemoteConfig({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: valid.SUPABASE_SERVICE_ROLE_KEY }),
    /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
  );
});

test("produces a summary that contains no key or password", () => {
  const summary = JSON.stringify(summarizeRemoteConfig(validateRemoteConfig(valid)));
  assert.equal(summary.includes("sb_secret_server_only"), false);
  assert.equal(summary.includes("password"), false);
  assert.match(summary, /abcxyz/);
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test scripts/phase2/remote-config.test.mjs`

Expected: FAIL，因为 `remote-config.mjs` 尚不存在。

- [ ] **Step 3: 实现配置验证**

```js
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
];

export function validateRemoteConfig(env) {
  const values = Object.fromEntries(REQUIRED_KEYS.map((key) => [key, env[key]?.trim()]));
  const missing = REQUIRED_KEYS.filter((key) => !values[key]);
  if (missing.length > 0) throw new Error(`Supabase 远程配置缺失：${missing.join(", ")}`);

  const projectUrl = new URL(values.NEXT_PUBLIC_SUPABASE_URL);
  if (projectUrl.protocol !== "https:" || !projectUrl.hostname.endsWith(".supabase.co")) {
    throw new Error("Supabase 远程配置无效：NEXT_PUBLIC_SUPABASE_URL");
  }
  if (/^(?:sb_secret_|service_role$)/i.test(values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("Supabase 远程配置无效：NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  if (!/^(?:sb_secret_|eyJ)/.test(values.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("Supabase 远程配置无效：SUPABASE_SERVICE_ROLE_KEY");
  }

  const dbUrl = new URL(values.SUPABASE_DB_URL);
  if (!["postgres:", "postgresql:"].includes(dbUrl.protocol) || dbUrl.password.length === 0) {
    throw new Error("Supabase 远程配置无效：SUPABASE_DB_URL");
  }

  return {
    url: projectUrl.toString().replace(/\/$/, ""),
    publishableKey: values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: values.SUPABASE_SERVICE_ROLE_KEY,
    dbUrl: values.SUPABASE_DB_URL,
    projectRef: projectUrl.hostname.split(".")[0],
  };
}

export function loadRemoteConfig(cwd = process.cwd()) {
  loadEnvConfig(cwd);
  return validateRemoteConfig(process.env);
}

export function summarizeRemoteConfig(config) {
  return {
    projectRef: config.projectRef,
    projectUrl: `https://${config.projectRef}.supabase.co`,
    publishableKey: "configured",
    serviceRoleKey: "configured",
    databaseUrl: "configured",
  };
}
```

- [ ] **Step 4: 更新环境变量示例**

在 `.env.example` 的服务端配置区加入：

```env
# 仅供 Supabase CLI 远程 migration 使用；从 Connect > Direct connection 复制，不得部署到浏览器。
SUPABASE_DB_URL=postgresql://postgres:your_database_password@db.your_project_ref.supabase.co:5432/postgres
```

- [ ] **Step 5: 运行配置测试**

Run: `node --test scripts/phase2/remote-config.test.mjs`

Expected: 4 tests PASS。

- [ ] **Step 6: 提交配置契约**

```powershell
git add .env.example scripts/phase2/remote-config.mjs scripts/phase2/remote-config.test.mjs
git commit -m "feat: add secure supabase remote config"
```

### Task 2: 建立白名单 Supabase CLI 执行器

**Files:**
- Create: `scripts/phase2/supabase-command.test.mjs`
- Create: `scripts/phase2/supabase-command.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `loadRemoteConfig()` 的 `dbUrl`。
- Produces: `buildSupabaseCommand(mode, dbUrl)` 和 CLI 入口；只允许 `check`、`dry-run`、`push`、`db-test` 四种模式。

- [ ] **Step 1: 写失败测试**

```js
import assert from "node:assert/strict";
import test from "node:test";

import { buildSupabaseCommand } from "./supabase-command.mjs";

const dbUrl = "postgresql://postgres:password@db.abcxyz.supabase.co:5432/postgres";

test("builds a migration history connection check", () => {
  assert.deepEqual(buildSupabaseCommand("check", dbUrl), ["supabase", "migration", "list", "--db-url", dbUrl]);
});

test("builds a dry-run before the mutating push", () => {
  assert.deepEqual(buildSupabaseCommand("dry-run", dbUrl), ["supabase", "db", "push", "--dry-run", "--db-url", dbUrl]);
  assert.deepEqual(buildSupabaseCommand("push", dbUrl), ["supabase", "db", "push", "--yes", "--db-url", dbUrl]);
});

test("runs the existing identity pgTAP suite remotely", () => {
  assert.deepEqual(buildSupabaseCommand("db-test", dbUrl), [
    "supabase", "test", "db", "supabase/tests/phase1_identity_rbac.sql", "--db-url", dbUrl,
  ]);
});

test("rejects every command outside the fixed allowlist", () => {
  assert.throws(() => buildSupabaseCommand("reset", dbUrl), /不支持的 Phase2 命令/);
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test scripts/phase2/supabase-command.test.mjs`

Expected: FAIL，因为 `supabase-command.mjs` 尚不存在。

- [ ] **Step 3: 实现白名单命令与进程调用**

```js
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { loadRemoteConfig, summarizeRemoteConfig } from "./remote-config.mjs";

const COMMANDS = {
  check: ["supabase", "migration", "list"],
  "dry-run": ["supabase", "db", "push", "--dry-run"],
  push: ["supabase", "db", "push", "--yes"],
  "db-test": ["supabase", "test", "db", "supabase/tests/phase1_identity_rbac.sql"],
};

export function buildSupabaseCommand(mode, dbUrl) {
  const base = COMMANDS[mode];
  if (!base) throw new Error(`不支持的 Phase2 命令：${mode}`);
  return [...base, "--db-url", dbUrl];
}

export function runSupabaseCommand(mode) {
  const config = loadRemoteConfig();
  console.log(JSON.stringify(summarizeRemoteConfig(config)));
  const [command, ...args] = buildSupabaseCommand(mode, config.dbUrl);
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(executable, [command, ...args], { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSupabaseCommand(process.argv[2]);
}
```

- [ ] **Step 4: 增加 package scripts**

```json
"phase2:config:test": "node --test scripts/phase2/*.test.mjs",
"phase2:check": "node scripts/phase2/supabase-command.mjs check",
"phase2:dry-run": "node scripts/phase2/supabase-command.mjs dry-run",
"phase2:push": "node scripts/phase2/supabase-command.mjs push",
"phase2:db-test": "node scripts/phase2/supabase-command.mjs db-test",
"phase2:verify": "node scripts/phase2/verify-remote.mjs"
```

- [ ] **Step 5: 运行命令生成测试**

Run: `node --test scripts/phase2/supabase-command.test.mjs`

Expected: 4 tests PASS，测试过程不连接远程项目。

- [ ] **Step 6: 提交 CLI 执行器**

```powershell
git add package.json scripts/phase2/supabase-command.mjs scripts/phase2/supabase-command.test.mjs
git commit -m "feat: add guarded supabase migration commands"
```

### Task 3: 建立脱敏初始化验证器

**Files:**
- Create: `scripts/phase2/verify-remote.test.mjs`
- Create: `scripts/phase2/verify-remote.mjs`

**Interfaces:**
- Consumes: `loadRemoteConfig()` 和 Supabase service-role Data API 客户端。
- Produces: `verifyRemoteState(client): Promise<VerificationReport>`，报告系统配置数量和业务数据表是否为空。

- [ ] **Step 1: 写失败测试**

```js
import assert from "node:assert/strict";
import test from "node:test";

import { classifyCounts } from "./verify-remote.mjs";

test("accepts required system data and empty business tables", () => {
  const report = classifyCounts({
    tenants: 1, organizations: 1, roles: 6, permissions: 18,
    departments: 5, identity_providers: 1, organization_members: 0,
    employee_profiles: 0, projects: 0, tasks: 0, audit_logs: 0,
  });
  assert.equal(report.systemReady, true);
  assert.equal(report.businessDataImported, false);
});

test("flags any business record instead of hiding it", () => {
  const report = classifyCounts({
    tenants: 1, organizations: 1, roles: 6, permissions: 18,
    departments: 5, identity_providers: 1, organization_members: 0,
    employee_profiles: 0, projects: 1, tasks: 0, audit_logs: 0,
  });
  assert.equal(report.businessDataImported, true);
  assert.deepEqual(report.nonEmptyBusinessTables, ["projects"]);
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test scripts/phase2/verify-remote.test.mjs`

Expected: FAIL，因为 `verify-remote.mjs` 尚不存在。

- [ ] **Step 3: 实现数量分类与远程读取**

定义系统表 `tenants`、`organizations`、`roles`、`permissions`、`departments`、`identity_providers`；定义业务数据表 `organization_members`、`employee_profiles`、`files`、`objectives`、`projects`、`project_members`、`milestones`、`tasks`、`task_comments`、`daily_reports`、`project_activities`、`project_risks`、`file_relations`、`attendance`、`approvals`、`approval_steps`、`approval_actions`、`salary`、`decision_commands`、`department_work_orders`、`task_dependencies`、`support_requests`、`leave_requests`、`payroll_runs`、`knowledge_documents`、`external_identities`、`audit_logs`。

每张表通过以下真实 Data API 请求获取精确数量：

```js
const { count, error } = await client
  .from(table)
  .select("*", { count: "exact", head: true });
if (error) throw new Error(`远程表验证失败：${table} (${error.code ?? "unknown"})`);
counts[table] = count ?? 0;
```

`classifyCounts` 必须满足：租户、组织、角色、权限、部门和身份 Provider 数量均大于零才设置 `systemReady: true`；任一业务表数量大于零时设置 `businessDataImported: true` 并列出表名。入口使用：

```js
const config = loadRemoteConfig();
const client = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const report = await verifyRemoteState(client);
console.log(JSON.stringify({ projectRef: config.projectRef, ...report }, null, 2));
if (!report.systemReady || report.businessDataImported) process.exitCode = 1;
```

- [ ] **Step 4: 运行验证器测试**

Run: `node --test scripts/phase2/verify-remote.test.mjs`

Expected: 2 tests PASS。

- [ ] **Step 5: 运行全部 Phase2 脚本测试**

Run: `npm run phase2:config:test`

Expected: 10 tests PASS，且没有远程连接和密钥输出。

- [ ] **Step 6: 提交远程验证器**

```powershell
git add scripts/phase2/verify-remote.mjs scripts/phase2/verify-remote.test.mjs
git commit -m "feat: verify supabase initialization safely"
```

### Task 4: 配置真实环境并初始化远程数据库

**Files:**
- Create locally, ignored: `.env.local`
- Create: `docs/phase2-supabase-initialization-result.md`

**Interfaces:**
- Consumes: 用户在本机 `.env.local` 填写的四项真实配置，以及前三项用户已有、第四项来自 Connect > Direct connection。
- Produces: 已应用 migration、通过的 pgTAP 结果、脱敏数据库初始化报告。

- [ ] **Step 1: 创建并打开本地配置文件**

创建未跟踪的 `.env.local`，内容为：

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
```

在 Codex 编辑器中打开该文件，让用户在本机粘贴真实值。确认 `git check-ignore .env.local` 返回 `.env.local`，且 `git status --short` 不显示该文件。

- [ ] **Step 2: 验证本地配置和远程连接**

Run: `npm run phase2:check`

Expected: 输出脱敏项目 ref 和远程 migration 历史；不出现 Secret Key、数据库用户名密码或完整连接字符串。

- [ ] **Step 3: 预演 migration**

Run: `npm run phase2:dry-run`

Expected: 退出码 0，列出将应用的 `supabase/migrations/*.sql`，不修改远程数据库。

- [ ] **Step 4: 正式应用 migration**

Run: `npm run phase2:push`

Expected: 退出码 0；不要附加 `--include-seed`。

- [ ] **Step 5: 再次核对 migration 历史**

Run: `npm run phase2:check`

Expected: 本地九个 migration 与远程历史一致，没有待执行 migration。

- [ ] **Step 6: 运行远程身份与 RLS 测试**

Run: `npm run phase2:db-test`

Expected: `supabase/tests/phase1_identity_rbac.sql` 全部 PASS，并在事务末尾 `rollback`，不保留测试用户或测试租户。

- [ ] **Step 7: 验证系统数据和零业务数据**

Run: `npm run phase2:verify`

Expected: `systemReady: true`、`businessDataImported: false`，量子星河系统租户、组织、角色、权限、五个部门和身份 Provider 均存在。

- [ ] **Step 8: 创建脱敏初始化报告**

```markdown
# Phase2 Supabase 初始化结果

- 环境变量：4/4 已配置，密钥未输出
- Data API：连接成功
- PostgreSQL：连接成功
- Migration：9/9 已应用
- 企业身份结构：通过
- RBAC：通过
- employee_profiles.skills：通过
- audit_logs 与 RLS：通过
- 业务数据导入：0 条

最终结果：通过
```

报告补充实际系统表数量和 migration 文件名，但不得包含密钥、数据库密码或完整连接字符串。

- [ ] **Step 9: 运行本地回归验证并提交报告**

Run: `npm run phase2:config:test && npm test && npm run typecheck && npm run lint`

Expected: 所有命令退出码 0。

```powershell
git add docs/phase2-supabase-initialization-result.md
git commit -m "docs: record supabase initialization result"
```
