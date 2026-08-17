# QuantXY 安全演示登录设计

## 目标

融合版工作站 `/quantxy-ai-workbench-fused.html` 直接展示已经存在的账号密码演示登录卡片，不再先跳转到飞书登录页。登录成功后进入同一个单文件工作站，并继续支持右上角演示身份切换。

模型 API Key 仍然只保存在服务器加密存储中。演示登录不能只是浏览器本地标记；HTTP 部署下必须由服务器验证账号密码并签发 HttpOnly 会话 Cookie，模型配置和模型调用接口只接受有效的服务器会话。

## 选择

采用“单文件登录界面 + Next.js 演示会话接口”方案：

- 保留现有 QuantXY 蓝白登录卡片、账号、密码、显示密码、记住登录和错误提示。
- 新增 `/api/demo-auth/login`、`/api/demo-auth/session`、`/api/demo-auth/logout`。
- 登录成功后签发 HMAC-SHA256 签名、带过期时间的 HttpOnly Cookie。
- `/api/ai/config` 和 `/api/ai/chat` 优先识别演示会话；没有演示会话时仍兼容原 Supabase 工作区会话。
- 中间件只对融合版 HTML、演示认证接口和自带鉴权的 AI 接口放行；其他 Next.js 页面继续使用现有飞书登录和角色权限。

## 配置与安全边界

- `WORKSTATION_DEMO_USERNAME`：可选，默认 `admin`。
- `WORKSTATION_DEMO_PASSWORD`：服务器必填，不写入 HTML、浏览器存储或日志。
- `WORKSTATION_DEMO_TENANT_ID`：服务器必填，必须是当前企业在 `tenants.public_id` 中的 UUID。
- `AI_CONFIG_ENCRYPTION_KEY`：继续作为 API Key 加密主密钥，并通过域分离派生演示会话签名密钥。
- 登录失败只返回通用错误，不回显账号、密码或服务器配置。
- Cookie 使用 `HttpOnly`、`SameSite=Lax`、`Path=/`；生产环境增加 `Secure`。
- 勾选“记住登录”时有效期 30 天，否则 8 小时。
- `file://` 继续保留原本的纯前端演示登录，但无法直接更新服务器模型配置；安全入口仍指向 HTTP 服务版。

## 数据流

1. 浏览器直接访问融合版 HTML，中间件不再重定向到 `/login`。
2. HTML 查询 `/api/demo-auth/session`；有效 Cookie 直接进入工作站，否则显示原演示登录卡片。
3. 用户提交账号密码到 `/api/demo-auth/login`；服务器恒定时间校验并签发 Cookie。
4. HTML 清空密码输入，只保留内存中的“已登录”状态并进入工作站。
5. AI 配置和聊天请求携带同源 Cookie；服务端还原为只对当前演示租户有效的管理员会话。
6. 退出时调用 `/api/demo-auth/logout` 清 Cookie，再回到同一登录卡片。

## 错误处理

- 空账号或密码：前端直接提示。
- 凭据错误：服务器返回 `401 invalid_credentials`，前端显示“账号或密码错误”。
- 部署缺少密码或租户：服务器返回 `500 server_misconfigured`，不返回缺失值。
- 会话过期或签名无效：会话查询返回未登录，AI 接口返回 `401`。
- 网络失败：登录卡片保留输入账号、清空密码并显示“服务器连接失败”。

## 验收

- 访问融合版 HTML 时不出现飞书登录页，直接出现原演示登录卡片。
- 错误密码不能进入工作站，也不能读取或修改模型配置。
- 正确密码签发 HttpOnly Cookie，刷新后仍保持登录。
- 退出后 Cookie 被清除并返回演示登录卡片。
- 模型 Key 不进入 HTML、localStorage、sessionStorage、响应正文或日志。
- 原 Supabase/飞书认证页面和其他工作台路由保持不变。
- HTML 合同、认证单元测试、AI 配置测试、类型检查、代码规范和生产构建全部通过。
