# 企业工作站飞书 OAuth 登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为企业工作站增加飞书 OAuth 登录、签名会话、后台路由保护和 Header 飞书用户展示，并保持现有业务模块不变。

**Architecture:** 飞书协议细节集中在 `src/services/feishu/`，Route Handlers 只编排跳转、Cookie 和错误映射。OAuth state 与最小用户会话存入 HttpOnly Cookie，会话使用由 `FEISHU_APP_SECRET` 派生的 HMAC-SHA256 签名；`(workspace)` Server Layout 统一读取会话并保护后台页面。

**Tech Stack:** Next.js 15.5.22 App Router、React 19、TypeScript、Tailwind CSS、Shadcn UI、Vitest、Playwright、Node.js Crypto、飞书 OAuth v2。

## Global Constraints

- 不修改 Dashboard、Projects、Workspace、Activities、People、Attendance、Approvals、Payroll 等业务模块。
- 不引入 Supabase 用户写入、复杂角色权限、飞书通讯录、消息或审批 API。
- 不在客户端、Cookie、HTML、日志或错误提示中暴露 `FEISHU_APP_SECRET`、授权码或访问令牌。
- 登录页严格复用已有 QuantXY 品牌素材、`public/dashboard/welcome-space-bg.png` 和已提供登录设计稿的白蓝玻璃拟态视觉。
- 使用飞书授权端点 `https://accounts.feishu.cn/open-apis/authen/v1/authorize`、令牌端点 `https://open.feishu.cn/open-apis/authen/v2/oauth/token`、用户端点 `https://open.feishu.cn/open-apis/authen/v1/user_info`。
- Next.js 15 的 `cookies()` 使用异步调用。
- 当前 `.git` 目录为空，实施时记录测试检查点；仓库元数据恢复后再执行计划中的提交命令。

---

## File Map

### Create

- `src/services/feishu/oauth.ts`: 配置、授权 URL、授权码换 token。
- `src/services/feishu/oauth.test.ts`: OAuth 配置与协议测试。
- `src/services/feishu/user.ts`: 登录用户信息请求与映射。
- `src/services/feishu/user.test.ts`: 用户响应映射与失败测试。
- `src/services/feishu/auth.ts`: state、签名会话、Cookie 选项和服务端会话读取。
- `src/services/feishu/auth.test.ts`: 会话签名、篡改、过期与 Cookie 配置测试。
- `src/app/api/auth/feishu/login/route.ts`: 发起飞书授权。
- `src/app/api/auth/feishu/login/route.test.ts`: 授权跳转和 state Cookie 测试。
- `src/app/api/auth/feishu/callback/route.ts`: 回调、state 校验、用户获取和会话写入。
- `src/app/api/auth/feishu/callback/route.test.ts`: 回调成功与失败测试。
- `src/app/api/auth/feishu/logout/route.ts`: 清除会话。
- `src/app/api/auth/feishu/logout/route.test.ts`: 退出 Cookie 测试。
- `src/app/login/page.tsx`: 登录路由与已登录重定向。
- `src/features/auth/feishu-login-page.tsx`: 登录页视觉和预留交互。
- `src/features/auth/feishu-login-page.test.tsx`: 登录页结构、链接和错误测试。
- `src/app/(workspace)/layout.test.tsx`: 后台保护测试。
- `tests/e2e/feishu-auth.spec.ts`: 未登录保护、登录入口和测试会话集成。

### Modify

- `src/app/(workspace)/layout.tsx`: 读取会话、未登录重定向、传递用户。
- `src/components/shell/workspace-shell.tsx`: 接收用户并传给 Header。
- `src/components/shell/workspace-header.tsx`: 展示飞书头像/姓名并提交退出请求。
- `src/components/shell/workspace-shell.test.tsx`: 使用飞书测试用户验证 Header。
- `playwright.config.ts`: 为既有后台 E2E 注入签名测试会话，避免现有测试被路由保护阻断。
- `.env.example`: 仅补充三个飞书变量名和无敏感信息的示例格式。

---

### Task 1: 飞书 OAuth 协议服务

**Files:**
- Create: `src/services/feishu/oauth.test.ts`
- Create: `src/services/feishu/oauth.ts`
- Create: `src/services/feishu/user.test.ts`
- Create: `src/services/feishu/user.ts`

**Interfaces:**
- Consumes: `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_REDIRECT_URI`。
- Produces: `getFeishuOAuthConfig()`、`buildFeishuAuthorizationUrl(state)`、`exchangeFeishuAuthorizationCode(code, fetchImpl?)`、`fetchFeishuCurrentUser(accessToken, fetchImpl?)`、`FeishuWorkspaceUser`。

- [ ] **Step 1: 写 OAuth 配置和授权 URL 的失败测试**

```ts
import { describe, expect, it } from "vitest";

import {
  buildFeishuAuthorizationUrl,
  getFeishuOAuthConfig,
} from "@/services/feishu/oauth";

const env = {
  FEISHU_APP_ID: "cli_test",
  FEISHU_APP_SECRET: "secret-test-value",
  FEISHU_REDIRECT_URI: "http://localhost:3000/api/auth/feishu/callback",
};

describe("Feishu OAuth", () => {
  it("rejects missing server configuration without exposing a secret", () => {
    expect(() => getFeishuOAuthConfig({})).toThrow("飞书 OAuth 环境变量未完整配置");
  });

  it("builds the current authorization endpoint without the app secret", () => {
    const url = buildFeishuAuthorizationUrl("state-123", env);
    expect(url.origin + url.pathname).toBe("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
    expect(url.searchParams.get("client_id")).toBe("cli_test");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(env.FEISHU_REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.toString()).not.toContain(env.FEISHU_APP_SECRET);
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npx vitest run src/services/feishu/oauth.test.ts`

Expected: FAIL，提示无法解析 `@/services/feishu/oauth`。

- [ ] **Step 3: 实现配置、授权 URL 和脱敏错误类型**

```ts
const AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";

export class FeishuOAuthError extends Error {
  constructor(public readonly code: "configuration" | "token" | "user") {
    super(code === "configuration" ? "飞书 OAuth 环境变量未完整配置" : "飞书 OAuth 请求失败");
  }
}

export function getFeishuOAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  const appId = env.FEISHU_APP_ID?.trim();
  const appSecret = env.FEISHU_APP_SECRET?.trim();
  const redirectUri = env.FEISHU_REDIRECT_URI?.trim();
  if (!appId || !appSecret || !redirectUri) throw new FeishuOAuthError("configuration");
  const redirect = new URL(redirectUri);
  if (!['http:', 'https:'].includes(redirect.protocol)) throw new FeishuOAuthError("configuration");
  return { appId, appSecret, redirectUri };
}

export function buildFeishuAuthorizationUrl(
  state: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = getFeishuOAuthConfig(env);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url;
}
```

- [ ] **Step 4: 添加令牌交换失败测试**

```ts
it("exchanges a code through the v2 JSON token endpoint", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({ code: 0, access_token: "user-token", expires_in: 7200, token_type: "Bearer" });
  };
  const token = await exchangeFeishuAuthorizationCode("one-time-code", fetchImpl, env);
  expect(token).toEqual({ accessToken: "user-token", expiresIn: 7200, tokenType: "Bearer" });
  expect(requests[0]?.url).toBe("https://open.feishu.cn/open-apis/authen/v2/oauth/token");
  expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
    grant_type: "authorization_code",
    client_id: "cli_test",
    code: "one-time-code",
    redirect_uri: env.FEISHU_REDIRECT_URI,
  });
});
```

- [ ] **Step 5: 运行令牌测试并确认缺少导出而失败**

Run: `npx vitest run src/services/feishu/oauth.test.ts`

Expected: FAIL，提示 `exchangeFeishuAuthorizationCode` 未导出。

- [ ] **Step 6: 实现令牌交换**

```ts
export async function exchangeFeishuAuthorizationCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = getFeishuOAuthConfig(env);
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || body.code !== 0 || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    throw new FeishuOAuthError("token");
  }
  return { accessToken: body.access_token, expiresIn: body.expires_in, tokenType: "Bearer" as const };
}
```

- [ ] **Step 7: 写用户信息映射的失败测试**

```ts
it("maps Feishu user info to the workspace identity", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({
    code: 0,
    msg: "success",
    data: {
      open_id: "ou_test",
      union_id: "on_test",
      user_id: "u_test",
      tenant_key: "tenant_test",
      name: "飞书测试用户",
      avatar_url: "https://example.com/avatar.png",
    },
  });
  await expect(fetchFeishuCurrentUser("user-token", fetchImpl)).resolves.toMatchObject({
    id: "ou_test",
    openId: "ou_test",
    displayName: "飞书测试用户",
    avatarUrl: "https://example.com/avatar.png",
  });
});
```

- [ ] **Step 8: 运行用户测试并确认模块不存在而失败**

Run: `npx vitest run src/services/feishu/user.test.ts`

Expected: FAIL，提示无法解析 `@/services/feishu/user`。

- [ ] **Step 9: 实现用户请求与结构校验**

```ts
const USER_INFO_URL = "https://open.feishu.cn/open-apis/authen/v1/user_info";

export type FeishuWorkspaceUser = {
  id: string;
  openId: string;
  unionId?: string;
  userId?: string;
  tenantKey?: string;
  displayName: string;
  avatarUrl?: string;
};

export async function fetchFeishuCurrentUser(accessToken: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(USER_INFO_URL, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=utf-8" },
  });
  const body = await response.json() as { code?: number; data?: Record<string, unknown> };
  const data = body.data;
  if (!response.ok || body.code !== 0 || !data || typeof data.open_id !== "string" || typeof data.name !== "string") {
    throw new FeishuOAuthError("user");
  }
  return {
    id: data.open_id,
    openId: data.open_id,
    unionId: typeof data.union_id === "string" ? data.union_id : undefined,
    userId: typeof data.user_id === "string" ? data.user_id : undefined,
    tenantKey: typeof data.tenant_key === "string" ? data.tenant_key : undefined,
    displayName: data.name,
    avatarUrl: typeof data.avatar_url === "string" ? data.avatar_url : undefined,
  } satisfies FeishuWorkspaceUser;
}
```

- [ ] **Step 10: 运行两个服务测试并记录绿色检查点**

Run: `npx vitest run src/services/feishu/oauth.test.ts src/services/feishu/user.test.ts`

Expected: PASS。

Commit after Git metadata is restored:

```bash
git add src/services/feishu/oauth.ts src/services/feishu/oauth.test.ts src/services/feishu/user.ts src/services/feishu/user.test.ts
git commit -m "feat: add feishu oauth services"
```

---

### Task 2: OAuth state 与签名会话

**Files:**
- Create: `src/services/feishu/auth.test.ts`
- Create: `src/services/feishu/auth.ts`

**Interfaces:**
- Consumes: `FeishuWorkspaceUser`、`getFeishuOAuthConfig()`。
- Produces: `OAUTH_STATE_COOKIE`、`SESSION_COOKIE`、`createOAuthState()`、`safeMatchOAuthState()`、`createSessionToken()`、`verifySessionToken()`、`getAuthCookieOptions()`、`getCurrentFeishuUser()`。

- [ ] **Step 1: 写会话签名、篡改和过期测试**

```ts
const user = { id: "ou_test", openId: "ou_test", displayName: "飞书测试用户" };
const secret = "session-secret";
const now = new Date("2026-08-05T08:00:00.000Z");

it("verifies an untampered session and rejects tampering or expiry", () => {
  const token = createSessionToken(user, now, secret);
  expect(verifySessionToken(token, new Date("2026-08-05T09:00:00.000Z"), secret)).toEqual(user);
  expect(verifySessionToken(`${token}x`, now, secret)).toBeNull();
  expect(verifySessionToken(`${token}.unexpected-segment`, now, secret)).toBeNull();
  expect(verifySessionToken(token, new Date("2026-08-05T17:00:01.000Z"), secret)).toBeNull();
});

it("uses callback protocol to select the Secure cookie attribute", () => {
  expect(getAuthCookieOptions("http://localhost:3000/api/auth/feishu/callback").secure).toBe(false);
  expect(getAuthCookieOptions("https://workspace.example.com/api/auth/feishu/callback").secure).toBe(true);
});
```

- [ ] **Step 2: 运行测试并确认模块不存在而失败**

Run: `npx vitest run src/services/feishu/auth.test.ts`

Expected: FAIL，提示无法解析 `@/services/feishu/auth`。

- [ ] **Step 3: 实现纯函数签名和 state 校验**

```ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const OAUTH_STATE_COOKIE = "ew_feishu_oauth_state";
export const SESSION_COOKIE = "ew_feishu_session";
export const SESSION_MAX_AGE = 8 * 60 * 60;

export function createOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function safeMatchOAuthState(expected?: string, received?: string) {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", `${secret}:enterprise-workspace-session-v1`).update(payload).digest("base64url");
}

export function createSessionToken(user: FeishuWorkspaceUser, now = new Date(), secret = getFeishuOAuthConfig().appSecret) {
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: now.getTime(), exp: now.getTime() + SESSION_MAX_AGE * 1000, user })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionToken(token: string, now = new Date(), secret = getFeishuOAuthConfig().appSecret) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, provided] = parts;
  if (!payload || !provided || !safeMatchOAuthState(signature(payload, secret), provided)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.v !== 1 || typeof parsed.exp !== "number" || parsed.exp <= now.getTime()) return null;
    if (!parsed.user || typeof parsed.user.openId !== "string" || typeof parsed.user.displayName !== "string") return null;
    return parsed.user as FeishuWorkspaceUser;
  } catch { return null; }
}

export function getAuthCookieOptions(redirectUri = getFeishuOAuthConfig().redirectUri) {
  return { httpOnly: true, sameSite: "lax" as const, secure: new URL(redirectUri).protocol === "https:", path: "/" };
}

export async function getCurrentFeishuUser() {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value ? verifySessionToken(value) : null;
}
```

- [ ] **Step 4: 运行会话测试并记录绿色检查点**

Run: `npx vitest run src/services/feishu/auth.test.ts`

Expected: PASS。

Commit after Git metadata is restored:

```bash
git add src/services/feishu/auth.ts src/services/feishu/auth.test.ts
git commit -m "feat: add signed feishu sessions"
```

---

### Task 3: OAuth Route Handlers

**Files:**
- Create: `src/app/api/auth/feishu/login/route.test.ts`
- Create: `src/app/api/auth/feishu/login/route.ts`
- Create: `src/app/api/auth/feishu/callback/route.test.ts`
- Create: `src/app/api/auth/feishu/callback/route.ts`
- Create: `src/app/api/auth/feishu/logout/route.test.ts`
- Create: `src/app/api/auth/feishu/logout/route.ts`

**Interfaces:**
- Consumes: Task 1 OAuth/User 服务和 Task 2 会话服务。
- Produces: `GET /api/auth/feishu/login`、`GET /api/auth/feishu/callback`、`POST /api/auth/feishu/logout`。

- [ ] **Step 1: 写登录路由失败测试**

```ts
it("sets a short-lived state cookie and redirects to Feishu", async () => {
  const response = createFeishuLoginResponse("state-test", {
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret-test-value",
    FEISHU_REDIRECT_URI: "http://localhost:3000/api/auth/feishu/callback",
  });
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toContain("accounts.feishu.cn/open-apis/authen/v1/authorize");
  expect(response.cookies.get(OAUTH_STATE_COOKIE)?.value).toBe("state-test");
  expect(response.cookies.get(OAUTH_STATE_COOKIE)?.httpOnly).toBe(true);
});
```

- [ ] **Step 2: 运行登录路由测试并确认模块不存在而失败**

Run: `npx vitest run src/app/api/auth/feishu/login/route.test.ts`

Expected: FAIL，提示路由模块不存在。

- [ ] **Step 3: 实现登录路由**

```ts
export function createFeishuLoginResponse(state: string, env: NodeJS.ProcessEnv = process.env) {
  const url = buildFeishuAuthorizationUrl(state, env);
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_STATE_COOKIE, state, { ...getAuthCookieOptions(getFeishuOAuthConfig(env).redirectUri), maxAge: 600 });
  return response;
}

export async function GET() {
  return createFeishuLoginResponse(createOAuthState());
}
```

- [ ] **Step 4: 写回调状态拒绝与成功测试**

```ts
const request = new NextRequest("http://localhost:3000/api/auth/feishu/callback?code=code-test&state=state-test", {
  headers: { cookie: `${OAUTH_STATE_COOKIE}=state-test` },
});
const response = await handleFeishuCallback(request, {
  exchangeCode: async () => ({ accessToken: "token", expiresIn: 7200, tokenType: "Bearer" }),
  fetchUser: async () => ({ id: "ou_test", openId: "ou_test", displayName: "飞书测试用户" }),
  createToken: () => "signed-session",
});
expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("signed-session");

const invalid = await handleFeishuCallback(new NextRequest(
  "http://localhost:3000/api/auth/feishu/callback?code=code-test&state=wrong",
  { headers: { cookie: `${OAUTH_STATE_COOKIE}=state-test` } },
), dependencies);
expect(invalid.headers.get("location")).toContain("/login?error=invalid_state");
```

- [ ] **Step 5: 运行回调测试并确认模块不存在而失败**

Run: `npx vitest run src/app/api/auth/feishu/callback/route.test.ts`

Expected: FAIL，提示回调路由模块不存在。

- [ ] **Step 6: 实现回调编排和稳定错误码**

```ts
type CallbackDependencies = {
  exchangeCode: typeof exchangeFeishuAuthorizationCode;
  fetchUser: typeof fetchFeishuCurrentUser;
  createToken: typeof createSessionToken;
};

function clearOAuthState(response: NextResponse) {
  response.cookies.set(OAUTH_STATE_COOKIE, "", { ...getAuthCookieOptions(), maxAge: 0 });
  return response;
}

export async function handleFeishuCallback(request: NextRequest, dependencies: CallbackDependencies) {
  const error = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const login = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));
  if (error === "access_denied") return clearOAuthState(login("access_denied"));
  if (!code || !safeMatchOAuthState(expected, state ?? undefined)) return clearOAuthState(login("invalid_state"));
  try {
    const token = await dependencies.exchangeCode(code);
    const user = await dependencies.fetchUser(token.accessToken);
    const response = NextResponse.redirect(new URL("/dashboard", request.url));
    response.cookies.set(SESSION_COOKIE, dependencies.createToken(user), { ...getAuthCookieOptions(), maxAge: SESSION_MAX_AGE });
    return clearOAuthState(response);
  } catch {
    return clearOAuthState(login("oauth_failed"));
  }
}
```

- [ ] **Step 7: 写退出登录失败测试**

```ts
it("expires the session cookie and redirects to login", async () => {
  const response = await POST(new NextRequest("http://localhost:3000/api/auth/feishu/logout", { method: "POST" }));
  expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("");
  expect(response.cookies.get(SESSION_COOKIE)?.maxAge).toBe(0);
});
```

- [ ] **Step 8: 运行退出测试并确认模块不存在而失败**

Run: `npx vitest run src/app/api/auth/feishu/logout/route.test.ts`

Expected: FAIL，提示退出路由模块不存在。

- [ ] **Step 9: 实现 POST 退出路由**

```ts
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(SESSION_COOKIE, "", { ...getAuthCookieOptions(), maxAge: 0 });
  return response;
}
```

- [ ] **Step 10: 运行所有 Auth Route Handler 测试**

Run: `npx vitest run src/app/api/auth/feishu/login/route.test.ts src/app/api/auth/feishu/callback/route.test.ts src/app/api/auth/feishu/logout/route.test.ts`

Expected: PASS。

Commit after Git metadata is restored:

```bash
git add src/app/api/auth/feishu
git commit -m "feat: add feishu oauth routes"
```

---

### Task 4: 登录页

**Files:**
- Create: `src/features/auth/feishu-login-page.test.tsx`
- Create: `src/features/auth/feishu-login-page.tsx`
- Create: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `getCurrentFeishuUser()`、`/api/auth/feishu/login`、已有品牌 PNG 与 UI 组件。
- Produces: `/login` 页面和 `FeishuLoginPage({ errorCode })`。

- [ ] **Step 1: 写登录页视觉结构与交互失败测试**

```tsx
it("renders the approved QuantXY login surface and Feishu entry", async () => {
  const user = userEvent.setup();
  render(<FeishuLoginPage />);
  expect(screen.getByRole("img", { name: "量子星河 QuantXY" })).toBeVisible();
  expect(screen.getByRole("heading", { name: /高效协同/ })).toBeVisible();
  expect(screen.getByRole("link", { name: "飞书授权登录" })).toHaveAttribute("href", "/api/auth/feishu/login");
  await user.click(screen.getByRole("button", { name: "手机或邮箱登录" }));
  expect(screen.getByRole("status")).toHaveTextContent("暂未开放");
});

it("maps stable OAuth error codes to safe Chinese feedback", () => {
  render(<FeishuLoginPage errorCode="invalid_state" />);
  expect(screen.getByRole("alert")).toHaveTextContent("登录状态已失效，请重新发起飞书登录");
});
```

- [ ] **Step 2: 运行测试并确认组件不存在而失败**

Run: `npx vitest run src/features/auth/feishu-login-page.test.tsx`

Expected: FAIL，提示无法解析登录组件。

- [ ] **Step 3: 实现登录组件**

使用现有 `Image`、`Button`、`GlassCard`、Lucide `UsersRound`、`CalendarCheck2`、`ClipboardCheck`、`ShieldCheck` 图标。布局必须包含：

```tsx
<main className="relative min-h-screen overflow-hidden bg-[#f4f8ff]">
  <Image src="/dashboard/welcome-space-bg.png" alt="" fill priority className="object-cover opacity-80" />
  <div className="relative mx-auto grid min-h-screen max-w-420 items-center gap-10 px-5 py-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(24rem,0.65fr)] lg:px-12">
    <section aria-label="企业工作站品牌介绍">{/* Logo、标题、三项能力与安全说明 */}</section>
    <GlassCard className="w-full max-w-120 justify-self-center p-6 sm:p-8">
      <h2 className="text-center text-xl font-semibold">企业账号登录</h2>
      <Button asChild size="lg" className="mt-8 h-12 w-full rounded-xl">
        <Link href="/api/auth/feishu/login">飞书授权登录</Link>
      </Button>
      {/* 手机/邮箱、短信登录为按钮；点击设置 status 文案“该登录方式暂未开放，请使用飞书授权登录。” */}
    </GlassCard>
  </div>
</main>
```

错误码固定映射：

```ts
const errorMessages = {
  access_denied: "你已取消飞书授权，可重新发起登录。",
  invalid_state: "登录状态已失效，请重新发起飞书登录。",
  oauth_failed: "飞书登录暂时失败，请稍后重试。",
} as const;
```

- [ ] **Step 4: 实现 Server Page 的已登录重定向**

```tsx
export default async function LoginRoute({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentFeishuUser()) redirect("/dashboard");
  return <FeishuLoginPage errorCode={(await searchParams).error} />;
}
```

- [ ] **Step 5: 运行登录页测试并记录绿色检查点**

Run: `npx vitest run src/features/auth/feishu-login-page.test.tsx`

Expected: PASS。

Commit after Git metadata is restored:

```bash
git add src/features/auth src/app/login
git commit -m "feat: add QuantXY feishu login page"
```

---

### Task 5: Workspace 路由保护与 Header 用户

**Files:**
- Create: `src/app/(workspace)/layout.test.tsx`
- Modify: `src/app/(workspace)/layout.tsx`
- Modify: `src/components/shell/workspace-shell.tsx`
- Modify: `src/components/shell/workspace-header.tsx`
- Modify: `src/components/shell/workspace-shell.test.tsx`

**Interfaces:**
- Consumes: `getCurrentFeishuUser()` 和 `FeishuWorkspaceUser`。
- Produces: 所有 `(workspace)` 页面统一认证保护、真实 Header 用户和退出提交。

- [ ] **Step 1: 写未登录保护失败测试**

```tsx
vi.mock("@/services/feishu/auth", () => ({ getCurrentFeishuUser: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT:/login"); }) }));

it("redirects unauthenticated workspace requests to login", async () => {
  vi.mocked(getCurrentFeishuUser).mockResolvedValue(null);
  await expect(WorkspaceLayout({ children: <p>受保护内容</p> })).rejects.toThrow("NEXT_REDIRECT:/login");
  expect(redirect).toHaveBeenCalledWith("/login");
});
```

- [ ] **Step 2: 运行 Layout 测试并确认当前实现未重定向**

Run: `npx vitest run "src/app/(workspace)/layout.test.tsx"`

Expected: FAIL，`redirect` 未被调用。

- [ ] **Step 3: 将 Workspace Layout 改为异步认证边界**

```tsx
export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentFeishuUser();
  if (!user) redirect("/login");
  return <WorkspaceShell user={user}>{children}</WorkspaceShell>;
}
```

- [ ] **Step 4: 更新 Header 测试为飞书用户契约**

```tsx
const feishuUser = {
  id: "ou_test",
  openId: "ou_test",
  displayName: "飞书测试用户",
  avatarUrl: "https://example.com/avatar.png",
};

render(<WorkspaceShell user={feishuUser}><p>驾驶舱内容</p></WorkspaceShell>);
expect(screen.getByText("飞书测试用户")).toBeVisible();
expect(screen.getByText("飞书企业用户")).toBeVisible();
expect(screen.getByRole("img", { name: "飞书测试用户" })).toHaveAttribute("src", feishuUser.avatarUrl);
const logoutButton = screen.getByRole("button", { name: "退出登录" });
expect(logoutButton).toHaveAttribute("type", "submit");
expect(logoutButton.closest("form")).toHaveAttribute("action", "/api/auth/feishu/logout");
```

- [ ] **Step 5: 运行 Shell 测试并确认 props 和内容不匹配而失败**

Run: `npx vitest run src/components/shell/workspace-shell.test.tsx`

Expected: FAIL，`WorkspaceShell` 不接受 user，Header 仍显示李总。

- [ ] **Step 6: 实现 Shell/Header 只读用户传递**

```tsx
export function WorkspaceShell({ children, user }: { children: ReactNode; user: FeishuWorkspaceUser }) {
  return <div className="workspace-mesh min-h-screen">{/* sidebar */}<WorkspaceHeader user={user} />{children}</div>;
}
```

Header 用户区域必须改为：

```tsx
<Avatar size="lg">
  {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.displayName} /> : null}
  <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
</Avatar>
<span className="hidden text-left sm:block">
  <span className="block text-sm font-semibold">{user.displayName}</span>
  <span className="block text-xs text-muted-foreground">飞书企业用户</span>
</span>
```

退出菜单使用真实 POST 表单：

```tsx
<form action="/api/auth/feishu/logout" method="post">
  <DropdownMenuItem asChild variant="destructive">
    <button type="submit" className="w-full"><LogOut aria-hidden="true" />退出登录</button>
  </DropdownMenuItem>
</form>
```

删除 Header 中只服务于 Mock 退出提示的 `demoMessage` 状态和说明 Dialog，不改搜索、通知、消息、帮助等其他交互。

- [ ] **Step 7: 运行 Layout 和 Shell 测试**

Run: `npx vitest run "src/app/(workspace)/layout.test.tsx" src/components/shell/workspace-shell.test.tsx`

Expected: PASS。

Commit after Git metadata is restored:

```bash
git add "src/app/(workspace)/layout.tsx" "src/app/(workspace)/layout.test.tsx" src/components/shell/workspace-shell.tsx src/components/shell/workspace-header.tsx src/components/shell/workspace-shell.test.tsx
git commit -m "feat: protect workspace with feishu session"
```

---

### Task 6: E2E 会话注入与认证流程验收

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/feishu-auth.spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `createSessionToken()`、`SESSION_COOKIE` 和三个飞书环境变量。
- Produces: 既有 E2E 的认证 storageState、飞书认证专项 E2E、环境变量示例。

- [ ] **Step 1: 写认证 E2E 并确认未登录保护与登录入口**

```ts
test("unauthenticated users are redirected to the Feishu login page", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: "飞书授权登录" })).toHaveAttribute("href", "/api/auth/feishu/login");
  await context.close();
});

test("the login endpoint starts the current Feishu authorization flow", async ({ request }) => {
  const response = await request.get("/api/auth/feishu/login", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const location = new URL(response.headers().location);
  expect(location.origin + location.pathname).toBe("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
  expect(location.searchParams.get("state")).toBeTruthy();
  expect(location.toString()).not.toContain(process.env.FEISHU_APP_SECRET ?? "never-output-secret");
});
```

- [ ] **Step 2: 运行认证 E2E 并确认因路由/页面尚未接入生产构建而失败**

Run: `npx playwright test tests/e2e/feishu-auth.spec.ts --workers=1`

Expected: 在新生产构建前 FAIL 或命中旧服务；记录具体失败后执行 Step 3。

- [ ] **Step 3: 在 Playwright 配置注入签名测试会话**

在 `playwright.config.ts` 顶部加载根目录环境并构造测试用户：

```ts
import { loadEnvConfig } from "@next/env";
import { createSessionToken, SESSION_COOKIE } from "./src/services/feishu/auth";

loadEnvConfig(process.cwd());
const e2eUser = { id: "ou_e2e", openId: "ou_e2e", displayName: "飞书验收用户" };
const e2eSession = createSessionToken(e2eUser);
```

为现有 Chrome project 增加：

```ts
use: {
  ...devices["Desktop Chrome"],
  storageState: {
    cookies: [{
      name: SESSION_COOKIE,
      value: e2eSession,
      domain: "127.0.0.1",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    }],
    origins: [],
  },
},
```

专项未登录测试必须显式创建空 storageState context，避免继承测试会话。

- [ ] **Step 4: 补充无敏感值的环境示例**

`.env.example` 保留现有内容并确保包含：

```dotenv
FEISHU_APP_ID=cli_your_app_id
FEISHU_APP_SECRET=your_app_secret
FEISHU_REDIRECT_URI=http://localhost:3000/api/auth/feishu/callback
```

- [ ] **Step 5: 运行单元、静态检查和生产构建**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: 所有命令退出码为 0；构建路由包含 `/login`、`/api/auth/feishu/login`、`/api/auth/feishu/callback`、`/api/auth/feishu/logout`。

- [ ] **Step 6: 重启已验证的本地生产服务**

先确认 3000 端口进程命令行属于 `E:\企业的工作站` 的 `next start`，仅停止该 PID。随后运行：

```powershell
npm run start
```

Expected: `http://localhost:3000/login` 返回 200；无会话访问 `/dashboard` 返回到 `/login`。

- [ ] **Step 7: 运行认证专项和完整 E2E**

Run:

```bash
npx playwright test tests/e2e/feishu-auth.spec.ts --workers=1
npm run test:e2e
```

Expected: 认证专项和现有产品回归测试全部通过。

- [ ] **Step 8: 视觉对比和真实授权手动验证**

1. 以设计稿同尺寸截取 `/login` 桌面页面和 430px 移动页面。
2. 将桌面截图与 `C:\Users\Administrator\Downloads\ChatGPT Image 2026年8月3日 15_38_22 (1).png` 并排检查 Logo、布局比例、玻璃卡片、圆角、背景、标题层级与留白。
3. 修复可见偏差后重新截图。
4. 用户在 `http://localhost:3000/login` 点击“飞书授权登录”并在飞书页面确认。
5. 验证回调进入 `/dashboard`、Header 显示当前飞书姓名/头像、退出后后台重新跳转 `/login`。

Expected: 应用侧自动化闭环通过；真实授权只需用户完成飞书确认，不要求向测试代码写入真实授权码或 token。

Commit after Git metadata is restored:

```bash
git add playwright.config.ts tests/e2e/feishu-auth.spec.ts .env.example
git commit -m "test: verify feishu authentication flow"
```

---

## Final Verification Checklist

- [ ] Secret 未出现在客户端代码、测试输出、截图、HTML 或 Cookie 中。
- [ ] OAuth state 缺失、错误、拒绝授权均返回稳定登录提示。
- [ ] 授权码只在服务端使用一次。
- [ ] 会话篡改和过期均被拒绝。
- [ ] 未登录后台统一跳转 `/login`。
- [ ] Header 展示飞书头像和姓名。
- [ ] 退出登录清除 Cookie。
- [ ] 原有业务模块源码未修改。
- [ ] 单元测试、类型检查、Lint、Build 和完整 E2E 均通过。
- [ ] 登录页桌面/移动端与现有设计体系一致。
