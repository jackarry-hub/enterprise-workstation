# QuantXY 部署手册

## Authorization gate

本手册不构成部署授权。部署必须绑定候选 commit/tree、迁移清单哈希、配置哈希、镜像摘要、目标环境指纹、备份 ID、回滚负责人和有效审批。Production 需要在 Staging 全绿后的新授权。

## Preflight

确认工作区干净，执行 `npm ci`、`npm run verify:commercial:local`，并检查依赖/密钥扫描。服务器只读核对磁盘、运行版本、数据库指纹、TLS、备份和 Storage 对象数；任何不一致停止。正式配置必须关闭 Demo/Mock。

## Staging deployment

按 `staging-validation-runbook.md` 在隔离 Staging dry-run、备份、迁移、固定镜像摘要并启动容器。完成数据库、七角色、桌面/移动、真机、外部服务、负载、恢复和 Canary，生成签名外部证据，运行 `npm run verify:commercial:staging`。

## Production boundary

未获得明确 Production 授权不得上传、推送迁移、切流或清理旧资源。获批后只部署同一候选摘要；Canary 通过再逐级扩流。发布后观察七天，保留当前和一个已验证回滚镜像；跨项目清理需另行授权。

