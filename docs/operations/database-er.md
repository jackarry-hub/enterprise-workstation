# QuantXY 数据关系说明

## Tenant and identity

`tenants -> organizations -> organization_members -> employee_profiles` 构成租户、组织、登录成员和员工档案主链。`external_identities`、`identity_providers` 与 `feishu_access_grants` 绑定外部身份；`roles -> role_permissions -> permissions` 和 `member_roles` 决定授权。所有业务外键必须同时约束 `tenant_id`，敏感档案拆分到 `employee_private_profiles`。

## Business domains

- 项目：`projects -> project_members/milestones/project_risks/project_activities -> tasks -> task_comments/task_dependencies`。
- 客户：`customers -> customer_contacts/customer_contracts/customer_follow_ups/opportunities`，导入导出有独立 job、row 和幂等表。
- 审批费用：`approval_templates -> approvals -> approval_steps/actions`；`expense_reports -> expense_receipts`。
- 薪资：`salary_grade_policies/payroll_policies -> payroll_runs -> salary`，未配置政策不得生成虚构档位。
- 知识与文件：`knowledge_directories/documents/versions/chunks/sources` 关联 `files/file_relations`。
- AI/Agent：会话、消息、运行、工具调用、预算、确认、Agent 版本/权限/编排/运行均持久化并审计。

## Integrity rules

135 张 `public` 表在迁移源码中声明 `ENABLE RLS` 和 `FORCE RLS`；实际状态必须由 Staging pgTAP 证明。写命令使用事务、幂等键、版本并发控制和固定 `search_path`。`audit_logs`、`audit_events` 禁止更新删除。请假/考勤历史表仅为兼容保留，不开放产品入口。

