# QuantXY 商用数据库 SOP

更新日期：2026-08-30

## 1. 事实边界

当前仓库使用 Supabase/Postgres、Auth、RLS 和 Storage。静态扫描确认迁移中创建的 135 张 `public` 表均声明 `ENABLE RLS` 与 `FORCE RLS`；这不是远程数据库已执行证明。本机未安装 Docker，因此 clean reset、真实 pgTAP、浏览器闭环和恢复演练均保持 `BLOCKED`，只能在获授权的隔离 Staging 中验证。

请假和考勤暂不属于公开产品范围；历史表/迁移为数据兼容保留，不得据此开放页面、导航或接口。正式源码不得回退到 Mock、fixture、localStorage 或 IndexedDB 业务仓库。

## 2. 环境与权限

Dev、CI/Test、Staging、Internal、Production 必须使用不同数据库和凭据。共享环境守卫只允许：

- Local/CI 指向精确的本机 Supabase 端口和数据库。
- Staging 仅在主机、端口、库名、用户、TLS 指纹全部匹配时做 dry-run；实际迁移还需独立授权。
- Internal 和 Production 默认拒绝任何数据库变更命令。

`service_role` 只存在于服务器和受控运维进程。浏览器只使用 publishable/anon key；任何密钥不得进入 Git、构建产物、截图、聊天记录或测试证据。

## 3. 迁移规则

1. 只新增前向迁移，不改写已应用文件，不插入旧编号，不手工修改迁移历史。
2. 候选冻结后计算每条迁移 SHA-256，并绑定审批记录、镜像摘要和配置哈希。
3. 先执行环境守卫和 dry-run，再创建可恢复备份；缺少 backup ID 时停止。
4. 只在隔离 Staging 应用迁移，随后运行全部 pgTAP/RLS、审计不可变、幂等/并发和限流测试。
5. 任何失败必须停止应用流量；不得用删数据、禁触发器、关闭 RLS 或伪造迁移标记绕过。

### 历史文件门禁

应用文件安全迁移前必须只读统计 `public.files`。若存在历史对象，先备份数据库和 bucket，再逐个核对租户、业务对象、上传人、MIME、实际字节、SHA-256、Storage object id/version/etag。完成独立重核验并在 Staging 通过后才可继续。禁止删除历史行或用空哈希、当前时间伪造“已核验”。

## 4. Seed 与身份

`supabase/seed.sql` 只创建 `quantxy-commercial-test` 隔离租户和 `.test` 身份，可重复执行，不导入客户、员工或生产数据。Staging 业务基础数据必须通过受控导入：

1. 初始化租户、组织、部门、岗位和角色权限。
2. 导入最小员工名册，绑定真实飞书身份；记录来源、操作者和审计事件。
3. 配置部门/职级/岗位薪资政策；缺失时显示“待配置”，禁止虚构档位。
4. owner、admin、supervisor、department_head、employee、hr、finance 逐一验证，supervisor 必须使用真实直属关系，不能用 owner 代替。

## 5. 必验数据库能力

- 所有 `public` 表 RLS/FORCE RLS，无匿名直接写权限。
- 跨租户读写为 0；敏感员工、薪资、审批、文件和 Agent 数据按角色/本人范围隔离。
- `audit_logs` 与 `audit_events` 数据库级不可更新、不可删除。
- 项目、任务、客户、审批、费用、知识、AI、Agent、通知等写 RPC 具备事务、幂等键、版本并发控制和安全 `search_path`。
- 分布式限流跨进程/重启持久，租户/用户/IP 隔离，锁定到期恢复，过期数据可有界清理。
- Storage 使用服务端签发、逐字节哈希核验、短期下载授权和失败清理。
- 就绪 RPC 返回当前候选要求的迁移标记 `202608300021`；旧标记或数据库不可达时应用返回 503。

## 6. 备份、恢复与发布

Staging 迁移前和生产发布前都必须生成不可变 backup ID。恢复演练只恢复到临时隔离目标，核对数据库和 Storage，记录实测 RPO/RTO。应用回滚仅在迁移向后兼容时允许；否则使用已验证备份恢复。

数据库和浏览器矩阵、飞书收发、DeepSeek 成功/失败、Storage、WAF、容器、真机、Canary、备份/恢复证据全部签署后，Staging 才可通过。Staging 通过仍需用户另行明确授权才能进行 Production 迁移和部署。

## 7. 当前结论

代码侧已有数据库安全基线、静态重置验证和验收契约；真实数据库运行状态尚未在本机验证。上线前必须按 `docs/operations/staging-validation-runbook.md` 与 `docs/operations/recovery-drill-runbook.md` 完成授权执行，任何缺项保持 `BLOCKED`。
