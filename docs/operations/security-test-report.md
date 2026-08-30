# QuantXY 安全测试报告

更新日期：2026-08-30

## Scope

覆盖身份、权限/RLS、CSRF、CSP/安全头、登录锁定、分布式限流、文件、Webhook、AI/Agent、依赖、密钥、容器和 WAF。请假考勤不在公开范围，历史数据结构仍受 RLS。

## Automated results

本地已通过安全单元/契约测试、依赖审计、类型、Lint 与生产构建；迁移静态扫描为 83 条迁移、135 张表均声明 RLS/FORCE RLS。容器配置已静态验证非 root、只读、cap drop、资源限制和就绪检查。本结果不证明真实数据库或 WAF 已应用。

## Staging evidence

真实 pgTAP、跨租户、七角色、登录锁定恢复、CSRF、文件逐字节、飞书验签、AI 超时/限流、WAF 签名、容器运行和浏览器 E2E 尚需隔离 Staging。证据必须哈希绑定候选并使用 Ed25519 签名。

## Open risks

本机无 Docker，真实数据库/容器未运行；部分业务模块仍被 `commercialReady=false` 隔离；本地融合预览资产尚未获批退役。三项均为最终发布硬阻断，不得以本报告替代。

