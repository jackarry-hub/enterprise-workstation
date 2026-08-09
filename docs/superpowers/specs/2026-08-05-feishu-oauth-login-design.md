# 企业工作站飞书 OAuth 登录设计

## 目标

在不修改 Dashboard、项目、任务、活动、人事、考勤、审批、薪资等业务模块的前提下，为企业工作站增加飞书 OAuth 登录闭环：

`/login` → 飞书授权 → `/api/auth/feishu/callback` → 获取飞书用户 → 建立本地会话 → `/dashboard`

登录成功后，Workspace Header 展示飞书用户头像和姓名；未登录访问 `(workspace)` 路由时统一跳转 `/login`。

## 已确认环境

- 项目使用 Next.js `15.5.22` App Router。
- 根目录 `.env.local` 已存在。
- `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_REDIRECT_URI` 均存在且非空。
- `FEISHU_REDIRECT_URI` 的路径为 `/api/auth/feishu/callback`，本地开发端口为 `3000`。
- 登录页继续使用已提供的 QuantXY Logo、登录设计稿与现有白蓝玻璃拟态视觉。

## 范围

### 本阶段实现

- `/login`
- `/api/auth/feishu/login`
- `/api/auth/feishu/callback`
- `/api/auth/feishu/logout`，用于接通 Header 已存在的退出登录入口
- `src/services/feishu/oauth.ts`
- `src/services/feishu/auth.ts`
- `src/services/feishu/user.ts`
- 签名 HttpOnly 会话 Cookie
- OAuth `state` Cookie 与回调校验
- `(workspace)` Layout 的统一登录保护
- Header 飞书头像、姓名和真实退出操作
- 登录、拒绝授权、状态失效、令牌失败和用户信息失败的页面反馈

### 本阶段不实现

- 不修改业务模块的数据来源和操作逻辑
- 不将飞书用户写入 Supabase
- 不实现复杂角色和权限映射
- 不保存 `user_access_token` 或 `refresh_token`
- 不调用通讯录、消息、审批等其他飞书 API
- 不增加手机号、邮箱或短信认证逻辑

## OAuth 接口

采用飞书当前网页 OAuth 接口：

- 授权地址：`https://accounts.feishu.cn/open-apis/authen/v1/authorize`
- 令牌地址：`https://open.feishu.cn/open-apis/authen/v2/oauth/token`
- 用户信息地址：`https://open.feishu.cn/open-apis/authen/v1/user_info`

授权请求只传入登录所需参数：

- `client_id`
- `response_type=code`
- `redirect_uri`
- 随机 `state`

本阶段不主动请求额外 `scope`，避免要求未在飞书开放平台开通的增量权限。用户信息接口返回登录用户基础身份；缺少可选敏感字段不影响登录。

## 服务边界

### `src/services/feishu/oauth.ts`

职责：

- 读取并校验飞书服务端环境变量
- 构造授权 URL
- 使用授权码调用 v2 令牌接口
- 将飞书错误响应规范化为内部错误，不泄露 App Secret 或访问令牌

公开接口：

```ts
type FeishuOAuthConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
};

type FeishuToken = {
  accessToken: string;
  expiresIn: number;
  tokenType: "Bearer";
};

getFeishuOAuthConfig(): FeishuOAuthConfig;
buildFeishuAuthorizationUrl(state: string): URL;
exchangeFeishuAuthorizationCode(code: string): Promise<FeishuToken>;
```

### `src/services/feishu/user.ts`

职责：

- 使用 `user_access_token` 获取登录用户信息
- 校验飞书响应结构
- 映射为企业工作站只读登录用户模型

公开接口：

```ts
type FeishuWorkspaceUser = {
  id: string;
  openId: string;
  unionId?: string;
  userId?: string;
  tenantKey?: string;
  displayName: string;
  avatarUrl?: string;
};

fetchFeishuCurrentUser(accessToken: string): Promise<FeishuWorkspaceUser>;
```

### `src/services/feishu/auth.ts`

职责：

- 生成 OAuth `state`
- 创建、校验、读取和清除会话
- 提供 Cookie 名称与安全属性
- 使用 HMAC-SHA256 对会话负载签名

会话只保存展示 Header 和识别登录状态所需的最小用户信息，不保存 OAuth access token。签名密钥由服务端 `FEISHU_APP_SECRET` 通过固定用途标签派生，避免增加本阶段环境变量；App Secret 轮换会自动使旧会话失效。

会话 Cookie 属性：

- `httpOnly: true`
- `sameSite: "lax"`
- `secure: new URL(FEISHU_REDIRECT_URI).protocol === "https:"`
- `path: "/"`
- `maxAge: 8 hours`

OAuth state Cookie 属性相同，但有效期为 10 分钟。

公开接口：

```ts
createOAuthState(): string;
createSessionToken(user: FeishuWorkspaceUser, now?: Date): string;
verifySessionToken(token: string, now?: Date): FeishuWorkspaceUser | null;
getCurrentFeishuUser(): Promise<FeishuWorkspaceUser | null>;
```

## 路由流程

### `GET /api/auth/feishu/login`

1. 检查三项飞书配置。
2. 生成高熵随机 `state`。
3. 将 `state` 写入 10 分钟 HttpOnly Cookie。
4. 302/307 跳转飞书授权页。

### `GET /api/auth/feishu/callback`

1. 读取 `code`、`state` 和 `error`。
2. 用户拒绝授权时，清除 state Cookie 并跳转 `/login?error=access_denied`。
3. 缺少 code/state 或 state 不一致时，清除 state Cookie 并跳转 `/login?error=invalid_state`。
4. 使用一次性 code 交换 `user_access_token`。
5. 获取飞书用户信息。
6. 创建 8 小时签名会话 Cookie。
7. 清除 state Cookie。
8. 跳转 `/dashboard`。
9. 令牌或用户信息请求失败时，不输出响应密钥，跳转 `/login?error=oauth_failed`。

### `POST /api/auth/feishu/logout`

1. 清除会话 Cookie。
2. 跳转 `/login`。

## 路由保护

`src/app/(workspace)/layout.tsx` 保持为 Server Component，并使用 Next.js 15 异步 Cookie API读取会话：

- 有效会话：将用户传入 `WorkspaceShell`，继续渲染页面。
- 无会话或签名/有效期校验失败：调用 `redirect("/login")`。

保护仅作用于 `(workspace)` 路由组，不影响 `/login`、OAuth API、静态资源和根路由。

## Header 集成

- `WorkspaceLayout` → `WorkspaceShell` → `WorkspaceHeader` 通过只读 props 传入 `FeishuWorkspaceUser`。
- Header 优先展示飞书头像；头像不可用时使用姓名首字回退。
- 姓名显示飞书 `displayName`。
- 当前没有角色映射，副标题固定显示“飞书企业用户”，避免伪造董事长、管理员等业务身份。
- 现有退出菜单改为提交 `/api/auth/feishu/logout`，不再显示 Mock 演示提示。
- 项目任务评论等现有 Mock 操作仍使用原业务 Mock User，防止本阶段改动业务行为。

## 登录页

- 使用独立 `/login` 路由，不套 Workspace Sidebar/Header。
- 桌面端还原设计稿的左侧品牌区、QuantXY Logo、企业工作站名称、白蓝渐变科技背景和右侧玻璃卡片。
- 飞书登录为主按钮，链接 `/api/auth/feishu/login`。
- 手机/邮箱与短信登录保留为不可提交的预留交互，并明确提示“暂未开放”。
- 移动端隐藏大面积品牌说明，保留 Logo、标题和玻璃登录卡片。
- 已登录访问 `/login` 时直接跳转 `/dashboard`。
- OAuth 错误通过稳定的错误码映射为中文提示，不展示飞书原始响应、App Secret 或 token。

## 错误与安全边界

- OAuth state 使用加密安全随机数并进行恒定时间比较。
- 授权码只在服务端交换，且不写入日志或客户端存储。
- App Secret 和 access token 不出现在 HTML、客户端 Bundle、Cookie 或错误信息中。
- 所有飞书请求设置 `cache: "no-store"`。
- 检查 HTTP 状态和飞书 JSON `code`，失败统一抛出脱敏错误。
- 会话签名验证失败、负载损坏或超过有效期都视为未登录。
- 当回调地址使用本地 HTTP 时不设置 Secure；部署为 HTTPS 回调地址后自动设置 Secure。

## 测试

### 单元测试

- 配置缺失时返回脱敏配置错误。
- 授权 URL 包含正确 client ID、redirect URI、response type 和 state，不包含 App Secret。
- 令牌交换请求使用 v2 JSON 协议。
- 用户信息映射姓名、头像和飞书 ID。
- 会话签名可验证，篡改和过期会话被拒绝。
- 登录路由写入 state Cookie 并跳转飞书。
- 回调拒绝缺失/不匹配 state。
- 回调成功写入会话并跳转 Dashboard。

### 页面和集成测试

- `/login` 保持设计稿的主要结构和飞书入口。
- 未登录访问 `/dashboard` 跳转 `/login`。
- 有效测试会话访问 `/dashboard` 并在 Header 显示测试飞书用户。
- 退出登录清除会话并返回 `/login`。

### 手动验证

- 在 `http://localhost:3000/login` 点击飞书登录。
- 在飞书授权页确认授权。
- 确认回调进入 `/dashboard`。
- 确认 Header 头像与姓名来自当前飞书账号。
- 确认退出后再次访问后台会回到 `/login`。

真实授权确认需要用户在飞书页面完成授权操作；自动化测试通过拦截外部飞书请求验证应用侧完整回调逻辑。

## 官方依据

- 飞书获取授权码：https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code
- 飞书获取 user_access_token：https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token?lang=zh-CN
- 飞书获取登录用户信息：https://open.feishu.cn/document/server-docs/authentication-management/login-state-management/get
- Next.js 15 Route Handlers：https://nextjs.org/docs/15/app/api-reference/file-conventions/route
- Next.js cookies：https://nextjs.org/docs/app/api-reference/functions/cookies
- Next.js redirect：https://nextjs.org/docs/15/app/guides/redirecting
