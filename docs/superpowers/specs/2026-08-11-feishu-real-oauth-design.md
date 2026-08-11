# 量子星河真实飞书 OAuth 接入设计

## 目标

在没有公网域名、暂未部署香港服务器的前提下，让 `http://localhost:3000` 上的企业工作站完成真实飞书 OAuth 登录。首个登录人是当前应用所有者，并在受控的一次性开通后成为量子星河 `owner/CEO`。身份核心继续使用通用 OAuth Provider、`tenant_id`、RBAC 和审计合同，不把数据库重新绑定为飞书专用结构。

本设计只覆盖登录、首个管理员开通、会话、页面保护和权限验证，不开发 Agent，不导入其他员工或业务数据。

## 当前状态

- Next.js 已有单一“使用飞书登录”入口、通用 OAuth Provider Registry、Supabase OAuth Server Action、回调、身份认领、退出和 Middleware 页面保护。
- 数据库已有 `tenants`、`organizations`、`identity_providers`、`external_identities`、`organization_members`、`employee_profiles`、RBAC、`skills` 和 `audit_logs`。
- 飞书“企业工作站”是企业自建应用，网页应用能力和基础身份权限已开启，但应用仍为“待上线”。桌面端和移动端主页均为 `http://localhost:3000`，安全设置尚未登记 OAuth 重定向 URL。
- Supabase 尚未创建 `custom:feishu`，Site URL 为 `http://localhost:3000`，Redirect URLs 为空；邮箱登录当前仍启用。
- `.env.local` 已配置 Supabase 项目连接，但 `NEXT_PUBLIC_APP_URL` 和真实飞书租户标识尚未配置。

## 方案选择

采用 **Supabase Custom OAuth2 Provider + Supabase Edge Function UserInfo Adapter + 本机 Next.js 回调**。

不采用临时 HTTPS 隧道，因为随机域名会导致飞书和 Supabase 配置频繁失效。不在本阶段部署完整生产环境，因为这会把域名、香港服务器、Nginx 和运维工作提前带入登录接入。

Supabase Edge Function 提供稳定的公网 HTTPS UserInfo URL，Supabase 可从云端访问；OAuth 完成后由浏览器跳回本机 `http://localhost:3000/auth/callback`，因此 Next.js 本身暂时不需要公网地址。

## 登录数据流

1. 员工在 `/login` 点击“使用飞书登录”。
2. Server Action 从 Provider Registry 解析 `custom:feishu`，保留安全的 `next` 相对路径，并调用 Supabase `signInWithOAuth`。
3. Supabase 发起飞书授权码流程并默认使用 PKCE。
4. 飞书把授权码回传到 Supabase Custom Provider 页面提供的只读 Callback URL。
5. Supabase 使用飞书 Token Endpoint 换取 `user_access_token`。
6. Supabase 调用 `feishu-userinfo` Edge Function。函数把 Bearer Token 转发到飞书官方 UserInfo API，验证响应并输出标准化的 `sub`、`provider_subject`、`provider_tenant_key`、`provider_match_keys`、姓名和头像；函数不记录 Token、授权码或完整身份响应。
7. Supabase 创建或恢复 Auth 会话，并把浏览器重定向到 `http://localhost:3000/auth/callback`。
8. Next.js 回调交换会话，调用 `claim_current_identity()`，再读取 `current_workspace_access()`。
9. 已开通身份进入角色首页；未开通、停用、离职或冲突身份被退出并跳到稳定的说明页。

## 云端配置

### Supabase Custom Provider

- Provider type：OAuth2，Manual configuration
- Name：`Feishu`
- Identifier：`custom:feishu`
- Client ID：飞书“企业工作站”的 App ID
- Client Secret：飞书“企业工作站”的 App Secret
- Authorization URL：`https://accounts.feishu.cn/open-apis/authen/v1/authorize`
- Token URL：`https://open.feishu.cn/open-apis/authen/v2/oauth/token`
- UserInfo URL：部署后的 `feishu-userinfo` Edge Function HTTPS URL
- Email optional：开启
- PKCE：保持开启
- Scope：`auth:user.access_token:read`，不申请手机号、邮箱或通讯录扩展权限作为登录前提

飞书 App Secret 只由用户在 Supabase Provider 表单中输入，不写入代码、`.env.local`、日志、文档或 Git。

### 回调地址

- 飞书安全设置登记：Supabase Custom Provider 页面显示的只读 Callback URL
- Supabase Site URL：`http://localhost:3000`
- Supabase Redirect URL：`http://localhost:3000/auth/callback`
- 飞书网页应用桌面端和移动端主页：`http://localhost:3000`

配置保存后创建飞书应用版本并发布，使 OAuth 配置对当前企业生效。所有保存、权限改变和发布操作在执行前单独向用户确认。

### 登录方式收敛

- 保持 Supabase OAuth 用户创建能力，使真实飞书身份能生成 `auth.users`。
- 禁用 Email Provider、Phone Provider、Anonymous Sign-ins 和 Manual Linking。
- 工作台授权不依赖“是否存在 Auth 用户”，只依赖预开通的组织身份、RBAC 和 RLS；未知飞书用户即使完成 OAuth，也不能进入任何工作台。

## Edge Function 设计

新增 `supabase/functions/feishu-userinfo/`，拆分为：

- `identity.ts`：纯函数校验飞书响应并生成通用 Provider claims。
- `index.ts`：处理 HTTP Bearer Token、超时、飞书 API 调用、数据库租户锁定读取和安全响应。
- `identity.test.ts`：覆盖合法身份、错误企业、缺少主体、异常邮箱、飞书错误响应和敏感信息不泄露。

函数仅接受格式合法的 Bearer Token，只允许 `GET`，调用上游使用短超时和 `no-store`。正式租户键写入 `identity_providers` 后，函数必须拒绝其他 `tenant_key`。首次管理员尚未锁定租户时，企业自建应用的 Client ID/Secret 是第一道企业边界；一次性开通过程会立即锁定真实租户键。

## 首个管理员开通

因为当前不知道企业邮箱，也不要求用户查找 `open_id` 或 `union_id`，采用受控的两次登录：

1. 首次真实飞书 OAuth 创建一个 Supabase Auth identity；由于组织成员仍为 0，回调显示“账号尚未开通”并清除本地会话。
2. 新增 migration `202608110001_feishu_first_owner_bootstrap.sql`，其中的 `bootstrap_first_owner_from_auth_identity(...)` 只允许 `service_role` 调用；新增本地命令 `scripts/phase3/bootstrap-first-owner.mjs`，负责找出唯一候选并调用该函数。两者必须同时验证：
   - 量子星河组织当前没有任何成员；
   - 只有一个未绑定的 `custom:feishu` Auth identity；
   - identity 包含非空 `provider_subject` 和 `tenant_key`；
   - 飞书 Provider 尚处于初始未锁定状态；
   - 目标角色固定为 `owner`，组织固定为 `quantxy / quantum-galaxy`。
3. 命令从已验证的 Auth identity 读取姓名、主体标识和飞书租户键，创建 CEO 员工档案、分配 `owner`、绑定 Auth 用户、锁定 Provider 租户键并写入 `audit_logs`。
4. 任何成员已存在、候选身份不是恰好一个、Provider 不匹配或租户已被不同值锁定时，命令失败且不写数据。
5. 用户第二次登录后进入 `/dashboard`。

一次性函数在成功后仍保留“零成员”硬条件，因此无法用于创建第二个 owner；后续员工继续使用已有名单预开通流程。

## 页面和错误处理

- 登录页仍只保留一个飞书按钮，不增加邮箱、密码或 Provider 选择器。
- Middleware 生成的安全 `next` 路径必须贯穿登录动作和回调；外部 URL、协议相对 URL、重复 `next` 和多重编码攻击继续被拒绝。
- 员工只看到简洁原因：登录失败、尚未开通、账号暂停、员工离职、身份异常或系统配置异常。
- 页面、URL、日志和审计 metadata 不显示 App Secret、Token、授权码、Cookie、完整飞书响应、数据库密码或 `service_role`。

## 安全边界

- OAuth 认证由 Supabase 和飞书完成；业务授权只由数据库组织身份、RBAC 和 RLS 决定。
- Edge Function 的 Service Role 仅用于读取当前 Provider 租户锁，不返回任何数据库配置，也不接受任意数据库操作参数。
- `tenant_id` 继续存在于所有身份和权限关系中；V1 只启用量子星河，不提供企业选择或切换入口。
- App Secret 只传输到 Supabase；首次输入和最终保存前由用户确认。
- PKCE 默认开启；只有真实联调明确返回飞书不支持 `code_challenge/code_verifier` 且保留脱敏证据时，才允许单独关闭。
- 所有外部写入操作按顺序执行和验证，不在同一步同时修改飞书、Supabase 和数据库，以便失败时准确回滚配置。

## 测试与验收

### 自动化

- Edge Function 身份规范化和错误映射单元测试。
- Server Action 测试：Provider Registry、回调地址和安全 `next` 传递。
- Callback 测试：成功进入 CEO 首页，未知/停用/离职/冲突身份被退出。
- Bootstrap 测试：零成员单候选成功；已有成员、零候选、多候选、错误 Provider、错误租户全部失败且不写数据。
- pgTAP/RLS：owner 可读当前租户审计；普通身份、其他租户和客户端直写被拒绝。
- 全量 Vitest、TypeScript、ESLint 和 Next.js build。

### 真实联调

1. 第一次飞书登录到达“账号尚未开通”。
2. 执行一次性 owner 开通，确认系统成员从 0 变为 1，角色为 owner，审计记录存在。
3. 第二次飞书登录进入 `/dashboard`。
4. 退出后直接访问工作台会返回登录页。
5. 未开通飞书身份不能进入工作台。
6. 日志和页面中没有 Secret、Token、授权码或完整身份标识。

## 不在本次范围

- Agent、AI 战略中心、Dify、LangGraph、n8n。
- 其他员工名单导入和五岗位批量验收。
- 正式域名、香港服务器、Nginx、Docker 生产部署。
- 飞书消息、通讯录同步、考勤、审批或机器人能力。

## 完成标准

只有以下条件全部成立，才能称为“真实 OAuth 已接入”：

- `custom:feishu` 已启用，飞书应用版本已发布，回调地址一致。
- 真实飞书授权和 Supabase 会话交换成功。
- 首个管理员已通过一次性安全流程成为 owner。
- 第二次登录进入老板驾驶舱，路由保护和退出有效。
- 未开通身份被拒绝，业务表除首个 owner 身份记录和审计外没有新增数据。
- 自动化、远程数据库验证和生产构建全部通过。
