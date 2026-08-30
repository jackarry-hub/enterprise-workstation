# QuantXY 秘密位置登记

## Rules

只登记位置、用途、Owner 和轮换周期，绝不记录秘密值。浏览器、Git、构建产物、截图、聊天和证据包不得包含 secret/service_role、数据库密码、飞书密钥、AI key、Cookie 或私钥。

## Location register

| 秘密 | 位置 | 用途 | Owner/轮换 |
| --- | --- | --- | --- |
| Supabase service role/DB password | 部署平台服务器秘密管理器 | 服务端数据/迁移 | Platform，90 天或事件后 |
| 飞书 app secret/webhook secret | 部署平台服务器秘密管理器 | OAuth/事件验签 | IAM，90 天或事件后 |
| DeepSeek API key | 部署平台服务器秘密管理器 | AI Provider | AI Owner，90 天或预算事件后 |
| Internal job token | 部署平台服务器秘密管理器 | `/api/internal/*` | Platform，30 天 |
| WAF/发布证据 Ed25519 私钥 | Staging Owner 离线签名存储 | 外部证据签名 | Security，180 天；公钥可分发 |

## Rotation

轮换先创建新版本、在隔离环境验证、灰度切换，再撤销旧值；记录时间、版本指纹和执行/复核者。疑似泄露立即撤销并按 P0/P1 响应，禁止通过日志验证密钥。

