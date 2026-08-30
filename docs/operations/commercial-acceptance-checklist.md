# QuantXY 商用验收清单

## Local evidence

- [x] 类型、Lint、构建、单元/契约、覆盖率和依赖/密钥检查已接入本地总闸门。
- [x] 83 条迁移/135 张表 RLS/FORCE RLS 静态完整性检查。
- [x] 交付文档、OpenAPI、CSV/XLSX、清单哈希验证器。
- [ ] 所有公开模块 `commercialReady=true` 且无 Mock/fixture/localStorage 业务源。
- [ ] 融合预览资产按授权证据退役。

## Staging evidence

- [ ] clean database、seed 幂等、pgTAP/RLS、审计和分布式限流。
- [ ] 七角色、第二租户、桌面/移动模拟、iOS/Android 真机全旅程。
- [ ] 飞书 OAuth/目录/事件、DeepSeek 成功/失败、Storage 逐字节/WAF。
- [ ] 100 员工、50 用户、20 并发写、10 AI/Agent 队列与三项性能阈值。
- [ ] 备份恢复 RPO≤24h/RTO≤4h、Canary、7 天观察、培训交接。

## Final release gate

签名外部清单必须与候选 commit/tree、迁移/配置/镜像哈希一致，所有证据文件可读且 SHA-256 匹配。Staging 通过后仍需新的 Production 明确授权；无授权不得上传、迁移、部署、切流或清理。

