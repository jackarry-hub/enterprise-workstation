# QuantXY 模型密钥后端安全接入设计

## 目标

把 `quantxy-ai-workbench-fused.html` 中的模型接入从“浏览器保存并直连模型服务”改为“浏览器只写新密钥、服务器加密保存、模型调用统一走同源后端”。设置页保持用户提供的参考布局：展示服务商、已配置状态、密钥尾号指纹、更新时间、API Base URL、模型选择和空白的新密钥输入框，但任何接口都不返回完整密钥。

## 已确认风险

- 当前 HTML 在初始配置中包含真实格式的硬编码 API Key。
- 当前配置会把 `S.cfg` 整体写入 `localStorage`，因此密钥会留在浏览器。
- 当前 `aiCall()` 会从浏览器直接向第三方模型接口发送 `Authorization` 或 `x-api-key`。
- 当前单文件演示登录只控制页面显示，不能作为服务器权限校验。

必须在模型服务商后台撤销并重置现有密钥。代码改造负责移除泄露路径，但无法让已经暴露的旧密钥重新安全。

## 选定方案

使用项目现有的 Next.js 15 + Supabase 服务端能力：

1. 浏览器通过 HTTPS 调用同源 Next.js Route Handler。
2. Route Handler 使用现有 Supabase 会话识别租户、用户和角色。
3. 新密钥在服务器使用 AES-256-GCM 加密后写入租户隔离的 Supabase 表。
4. 加密主密钥只存在于服务器环境变量 `AI_CONFIG_ENCRYPTION_KEY`，不使用 `NEXT_PUBLIC_` 前缀。
5. 模型调用由 `/api/ai/chat` 在服务器解密密钥并转发给 DeepSeek。
6. 配置查询永远只返回密钥是否存在、尾号指纹和更新时间。

没有选择把密钥写入服务器 `.env`，因为运行时网页无法可靠地更新进程环境变量；也没有选择仅用 Cloudflare Worker Secret，因为当前仓库已经具备 Next.js、Supabase 会话和服务端部署结构，新增独立平台会增加运维边界。

## 用户界面

系统设置的“大模型接入”卡片调整为：

- 服务商固定为 DeepSeek。
- 顶部显示“已配置”或“未配置”。
- 已配置时显示 `****8bcf` 形式的尾号指纹和更新时间。
- API Base URL 显示为 `https://api.deepseek.com`，只读，避免任意上游地址造成 SSRF。
- 模型可在允许列表中切换：`deepseek-v4-flash`、`deepseek-chat`、`deepseek-reasoner`。
- “输入新 Key 进行更新”输入框始终为空；只有用户正在输入时，值短暂存在于当前页面内存。
- 显示/隐藏按钮只作用于当前尚未提交的新值，不读取服务器旧值。
- 点击“更新密钥”后提交到后端，成功时立即清空输入框并刷新指纹和更新时间。
- 点击“保存模型”只更新模型，不要求重新输入密钥。
- 删除当前“清除”“API Key 回显”“跨域代理前缀”和浏览器保存 Key 的说明。

## 服务端数据

新增表 `public.ai_provider_configs`：

- `tenant_id uuid not null`
- `provider text not null default 'deepseek'`
- `model_name text not null`
- `api_base_url text not null`
- `encrypted_api_key text`
- `api_key_iv text`
- `key_hint text`
- `updated_at timestamptz not null`
- `updated_by uuid not null`
- 主键：`(tenant_id, provider)`

表启用 RLS，不给 `anon` 或 `authenticated` 创建读写策略。只有使用服务器端 `SUPABASE_SERVICE_ROLE_KEY` 的 Route Handler 能访问；每次查询必须同时限定当前会话的 `tenant_id`。

密钥加密格式：

- `AI_CONFIG_ENCRYPTION_KEY` 为 32 字节随机值的 Base64 编码。
- 算法为 AES-256-GCM。
- 每次更新生成新的 12 字节随机 IV。
- 密文包含 GCM 验证标签；解密失败统一返回服务器配置错误，不泄露密文、密钥或上游响应细节。
- `key_hint` 只保存密钥最后 4 个字符。

## API 合约

### `GET /api/ai/config`

已登录的工作站成员可读取脱敏配置：

```json
{
  "provider": "deepseek",
  "apiBaseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "keyConfigured": true,
  "keyHint": "8bcf",
  "updatedAt": "2026-08-17T12:00:00.000Z",
  "canManage": true
}
```

响应不得包含 `apiKey`、密文、IV、服务端环境变量或 Supabase 服务密钥。

### `PUT /api/ai/config`

仅企业决策人或拥有 `admin` 角色的用户可调用。请求支持：

```json
{
  "model": "deepseek-v4-flash",
  "apiKey": "sk-new-secret"
}
```

- `model` 必须在服务器允许列表中。
- `apiKey` 可省略；省略时只更新模型并保留原密钥。
- 传入 `apiKey` 时服务器加密后覆盖旧密文。
- 成功响应与 `GET` 相同，只返回脱敏配置。
- 不提供读取完整密钥或恢复旧密钥的接口。

### `POST /api/ai/chat`

已登录成员可调用。服务器完成：

1. 校验请求体大小和消息结构。
2. 按当前租户读取 DeepSeek 配置。
3. 解密 API Key。
4. 使用固定 DeepSeek Base URL 和允许的模型转发请求。
5. 设置超时和请求频率限制。
6. 将模型响应返回浏览器，但不透传包含内部配置的错误细节。

浏览器请求中不再包含第三方 API Key 或替代口令。

## 身份与权限

- Next.js 中间件继续负责刷新 Supabase 会话和确认工作区成员身份。
- `/api/ai` 对所有已登录角色可达，Route Handler 再做一次会话和租户校验。
- 配置读取和模型调用允许已登录成员；配置更新仅允许 `primaryRole === 'executive'` 或 `isAdmin === true`。
- 单文件页面中的身份切换 `S.me` 只改变演示视角，不参与服务器授权。
- 部署版 HTML 必须通过现有 Next.js 站点访问，不能把文件单独放到无后端、无身份验证的静态空间。

## HTML 调整

- 删除初始配置中的硬编码 API Key。
- `save()` 不再序列化任何密钥字段。
- `load()` 发现旧版 `qxy.cfg.apiKey` 时立即从内存中删除并覆盖本地记录，完成浏览器残留清理。
- `aiCall()` 固定请求 `/api/ai/chat`，不设置第三方鉴权头。
- 设置页启动时读取 `/api/ai/config` 的脱敏数据。
- 密钥输入提交成功或失败后均不写入 `S.cfg`；成功后清空 DOM 输入值。
- 部署副本放入 `public/quantxy-ai-workbench-fused.html`，并通过测试确保与根目录交付文件一致。

## 错误处理

- 未登录：返回 `401`，前端提示重新登录。
- 无配置权限：返回 `403`，隐藏更新按钮并显示只读状态。
- 新密钥为空或格式不合法：返回 `400`，不改变旧配置。
- 模型未在允许列表：返回 `400`。
- 未配置密钥：模型测试和 AI 对话提示“请由管理员先配置模型密钥”。
- 上游超时：返回 `504` 和通用提示。
- 上游鉴权失败：返回 `502` 和“模型密钥无效或已失效”，不返回上游原始正文。
- 数据库或解密失败：记录不含秘密的服务器错误标识，客户端只收到通用错误。

## 防滥用与日志

- 模型接口限制请求体最大 64 KiB、消息数量和单条消息长度。
- 对租户和用户实施基础频率限制；单机版本采用进程内限制，后续多实例部署应迁移到共享限流存储。
- 所有配置和模型响应使用 `Cache-Control: no-store`。
- 日志禁止记录请求中的 `apiKey`、`Authorization`、密文或完整上游请求体。
- 建议在 DeepSeek 控制台设置消费额度和账单告警。

## 部署配置

服务器环境变量新增：

- `AI_CONFIG_ENCRYPTION_KEY`
- 继续使用现有 `NEXT_PUBLIC_SUPABASE_URL`
- 继续使用现有 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- 继续使用现有 `SUPABASE_SERVICE_ROLE_KEY`

部署前执行 Supabase migration；随后通过受保护的模型设置页输入新密钥。旧密钥必须在模型服务商后台撤销。

## 验收标准

- HTML、JavaScript、构建产物和浏览器存储中均不存在完整 DeepSeek API Key。
- 设置页从不回显已保存密钥，只显示尾号和更新时间。
- 更新密钥后输入框立即清空，刷新页面仍只显示脱敏状态。
- 只修改模型时不需要重新输入密钥。
- 非企业决策人/管理员不能更新配置。
- 网络请求中只有浏览器到同源 `/api/ai/*` 的会话 Cookie，不包含第三方密钥。
- `/api/ai/chat` 能使用服务器密钥完成模型调用。
- 既有客户、活动、决策、登录和窄屏布局测试继续通过。
- 原始用户提供的 HTML 文件保持不变。

## 非目标

- 不提供密钥导出、复制、恢复或查看完整值。
- 不允许用户自定义任意第三方 API Base URL。
- 本轮只支持 DeepSeek，不扩展到其他模型供应商。
- 不在浏览器使用可逆加密或混淆来伪装密钥安全。
