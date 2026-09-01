# QuantXY 隔离 Staging 验证手册

本手册是操作契约，不是部署授权。没有用户对候选版本和隔离 Staging 的明确授权、独立凭据或环境指纹时，结论必须为 `BLOCKED`。

## 1. 授权门

操作者先记录审批号、候选提交、配置 SHA-256、迁移清单 SHA-256、目标环境、数据库只读指纹、计划开始/结束时间、回滚负责人。目标必须标记为 `Staging`，不得使用 Internal 或 Production 凭据。所有命令输出先脱敏；数据库 URL、密码、令牌、Cookie、员工隐私不得进入日志和证据包。

## 2. 只读预检

1. 验证仓库无未提交改动，候选提交与审批记录一致。
2. 运行 `npm ci`、类型、Lint、构建、单元、覆盖率、依赖/密钥扫描。
3. 对 Staging 数据库执行环境守卫和迁移 dry-run；只允许配置中登记的主机、端口、库名、用户和 TLS 模式。
4. 记录现有迁移、表/RLS、备份策略、Storage 对象数量和当前就绪状态。任何指纹不匹配立即停止。

## 3. 备份门

迁移前创建可恢复备份并记录不可变 backup ID、完成时间、恢复点、加密和保留策略。未能在供应商控制面确认备份可用时不得迁移。历史 `files` 不为空时必须按数据库 SOP 完成对象逐字节重核验，不得删除或伪造校验数据。

## 4. 获批后的 Staging 变更

以下动作只能在本节审批号有效、环境守卫再次确认为隔离 Staging 后由 Staging Owner 执行：

```text
supabase db push --dry-run --db-url <guarded-staging-url>
supabase db push --db-url <guarded-staging-url>
docker compose up -d --build
```

禁止把占位符替换成 Production 目标。执行后固定数据库迁移版本、镜像摘要和 Compose 配置哈希，`WORKSTATION_ALLOW_MOCK_DATA=false`、`WORKSTATION_DEMO_ENABLED=false` 必须不可覆盖。

## 5. 验收矩阵

1. 数据库：clean reset 等价验证、seed 幂等、全部 pgTAP/RLS、审计不可变、分布式限流持久性和清理通过。
2. 就绪：配置缺失、数据库断开、旧迁移均返回 503；完整配置和标记 `202609010001` 返回 200。
3. 身份：owner、admin、supervisor、department_head、employee、hr、finance 和第二租户隔离通过；supervisor 只能读取直属范围。
4. 浏览器：桌面和模拟移动端完成组织、项目/任务、客户、审批/费用、薪资、知识、AI、Agent、分析、设置全旅程，禁止 API 拦截和 Mock 回退。
5. 外部能力：飞书授权、目录、事件收发和失败重试；DeepSeek 成功、超时、限流和人工确认；Storage 上传、哈希核验、下载授权和过期清理。
6. 安全：CSRF、登录锁定恢复、WAF 规则、HTTP 头、无障碍、依赖和密钥扫描。
7. 真机：至少一台受支持 iOS 和 Android，验证键盘、表单、上传、弱网、离线恢复、通知入口和无横向溢出。

## 6. Canary 与停止线

Canary 只对审批记录中的小范围测试成员开放，记录持续时间、错误率、P95、数据库连接、队列积压和外部服务失败率。出现迁移不一致、跨租户读取、审计可改、5xx 超阈值、数据丢失、凭据泄露、就绪持续 503 或外部调用不可恢复时，立即停止流量并进入恢复手册。不得边观察边扩大范围。

## 7. 证据封存

使用 `scripts/collect-commercial-evidence.mjs` 生成初步清单，补齐数据库、外部能力、WAF、真机、备份/恢复和 Canary 证据。每个制品记录 SHA-256、生成时间、操作者和候选提交；WAF 证据必须由 Staging Owner Ed25519 签名。`verify:commercial:staging` 只有在 Task 7 验证器、全部证据和授权同时存在时才可通过。

Staging 通过仍不等于生产授权。生产动作需要新的、明确绑定同一候选与证据清单的用户授权。
