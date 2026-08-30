# QuantXY 商用架构

## Context

QuantXY 是企业工作台：Next.js 负责桌面端、移动 Web/PWA 和受保护 API；Supabase/Postgres 负责真实业务数据、Auth、RLS 与 Storage；飞书提供企业身份和组织同步；DeepSeek 仅作为经人工确认与预算约束的 AI Provider。正式模式禁止 Mock、fixture、localStorage/IndexedDB 业务仓库。

## Runtime topology

浏览器只持有 publishable/anon key 与受保护会话，经 Next.js Route Handler 调用服务层/RPC。服务端使用最小权限凭据访问 Supabase、飞书和 DeepSeek；后台恢复任务由只允许内部签名请求的 `/api/internal/*` 入口执行。容器以非 root、只读文件系统运行，就绪端点同时验证配置、数据库与迁移标记。

## Trust boundaries

租户、组织、成员、角色和数据范围以数据库为最终裁决，前端显隐不构成授权。外部 webhook 先验签、去重、落审计，再进入幂等处理。文件经服务端预签、对象逐字节 SHA-256 核验和短时下载授权。AI 工具调用受 allowlist、预算、风险分级、人工确认与 kill switch 约束。

## Failure model

数据库、飞书、AI 或 Storage 不可用时返回可诊断失败，不回退示例数据；重试必须携带幂等键并受分布式限流。迁移不一致、跨租户可见、审计可改、就绪 503 或外部失败不可恢复均停止 Canary。应用回滚必须兼容数据库；否则从已验证备份恢复到隔离目标。

