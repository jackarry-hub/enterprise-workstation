# 飞书身份与目录同步规则

## Authority

飞书是身份、在职状态和组织源之一，QuantXY 数据库是业务角色、权限、经理树和业务记录的最终裁决。同步只能使用已登记企业应用和最小 scopes，禁止把通讯录全量响应写入日志。

## Identity mapping

`tenant + provider + external identity` 唯一映射到组织成员；open_id/union_id 仅存受控表。首次登录先校验企业、成员状态和授权，再绑定，不允许按姓名猜测。部门、岗位和员工号必须通过确定性 external link/upsert 同步。

## Conflict handling

Webhook 先验签、去重和持久化，再按实体序列处理。并发同步使用租约；重复事件幂等。姓名冲突、部门缺失、经理循环、外部 ID 改绑进入 `directory_sync_issues`，管理员显式选择后修复，不能静默覆盖。

## Offboarding

离职/停用事件先禁用登录和新任务授权，再撤销 Agent、导出和敏感数据权限，保留业务归属与审计，按流程转移客户/项目。飞书不可用时不自动恢复权限；失败重试有上限并告警。

