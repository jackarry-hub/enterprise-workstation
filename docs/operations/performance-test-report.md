# QuantXY 性能测试报告

更新日期：2026-08-30

## Profile

固定商用基线：100 名隔离测试员工、50 活跃用户、20 并发写、10 个排队 AI/Agent 任务。测试数据只能进入隔离 Staging，禁止对 Internal/Production 造数。

## Thresholds

非 AI 请求 P95 ≤ 800ms；错误率 < 0.5%；移动端 P95 可交互 ≤ 3000ms。数据库连接、队列积压、外部失败率、CPU/内存同时记录，不允许只报告平均值。

## Results

本地只验证了阈值解析、证据字段和越线拒绝逻辑，没有伪造测量结果。实际值必须由相同候选的 Staging 负载证据提供，并由 `npm run load:commercial` 校验。

## Evidence status

当前 `BLOCKED_PENDING_AUTHORIZED_STAGING`。完成真实容器、数据库、种子、50 会话和移动测量后，记录工具版本、开始/结束、候选、配置/迁移哈希、原始报告 SHA-256 与复核签名。

