# QuantXY 数据字典

## Scope

本字典覆盖迁移创建的 135 张 `public` 表。字段、类型、默认值和约束以 `supabase/migrations/*.sql` 为唯一可执行来源；本文用于业务归属、敏感级别和运维定位，不替代 DDL。

## Table catalogue

| 域 | 表 | 用途与数据级别 |
| --- | --- | --- |
| 租户身份 | tenants, organizations, organization_members, employee_profiles, employee_private_profiles, external_identities, identity_providers, member_roles, roles, role_permissions, permissions, tenant_initializations | 企业、账号、员工、角色；私档/身份为高度敏感 |
| 组织能力 | departments, position_templates, position_skill_requirements, employee_skills, employee_work_profiles, skill_categories, skill_tags | 部门、岗位、技能与工作画像；内部数据 |
| 项目任务 | projects, project_members, project_risks, project_activities, milestones, tasks, task_comments, task_dependencies, task_acceptance_events, daily_reports, objectives, department_work_orders | 项目执行；成员范围敏感 |
| 项目财务 | project_bonus_pools, task_bonus_allocations, project_command_idempotency, project_execution_command_idempotency, task_command_idempotency | 奖金、命令去重；财务敏感 |
| 客户 CRM | customers, customer_contacts, customer_contracts, customer_follow_ups, customer_ownership_history, customer_project_links, opportunities, opportunity_stage_history, crm_source_links | 客户、联系人、合同、商机；联系人含 PII |
| CRM 交换 | crm_command_idempotency, crm_import_jobs, crm_import_rows, crm_export_jobs | 导入导出、逐行状态和审计 |
| 审批费用 | approval_templates, approvals, approval_steps, approval_actions, approval_action_idempotency, approval_command_idempotency, expense_reports, expense_receipts, expense_command_idempotency | 审批、报销、凭证；敏感财务数据 |
| 薪资 | salary_grade_policies, payroll_policies, payroll_runs, salary | 薪资政策、批次和个人薪资；高度敏感 |
| 知识文件 | knowledge_directories, knowledge_documents, knowledge_document_versions, knowledge_chunks, knowledge_sources, knowledge_permissions, knowledge_processing_jobs, knowledge_command_receipts, files, file_relations, file_upload_reservations | 文档、索引、权限和对象存储元数据 |
| 通知支持 | commercial_notifications, task_notifications, task_notification_delivery_attempts, support_requests | 通知投递、重试和支持工单 |
| 飞书目录 | directory_connections, directory_entity_links, directory_sync_runs, directory_sync_issues, feishu_access_grants, feishu_entity_sequences, feishu_oauth_attempts, feishu_offboarding_commands, feishu_sync_conflicts, feishu_sync_leases, feishu_webhook_events | OAuth、目录同步、冲突、租约、事件；身份敏感 |
| AI 运行 | ai_conversations, ai_messages, ai_tool_calls, ai_provider_configs, ai_runtime_invocations, ai_runtime_queue, ai_runtime_queue_commands, ai_runtime_budgets, ai_runtime_budget_reservations, ai_rate_limit_windows, ai_rate_limit_receipts, ai_human_confirmations, ai_human_takeover_queue, ai_high_risk_executions, ai_evaluation_cases | 会话、工具、队列、预算、人工确认；内容敏感 |
| Agent | agent_definitions, agent_versions, agent_version_tools, agent_tool_catalog, agent_permissions, agent_permission_requests, agent_runtime_controls, agent_runtime_data_allowlists, agent_runtime_tool_allowlists, agent_invocations, agent_invocation_steps, agent_execution_logs | 定义、版本、权限、运行控制与日志 |
| Agent 编排 | agent_orchestrations, agent_orchestration_versions, agent_orchestration_nodes, agent_orchestration_edges, agent_orchestration_runs, agent_orchestration_node_runs | 编排图与运行状态 |
| 调度决策 | scheduling_goals, scheduling_plan_versions, scheduling_assignments, scheduling_dispatch_tasks, scheduling_overrides, decision_commands | 目标、计划、派发、覆盖和决策命令 |
| 安全审计 | audit_logs, audit_events, distributed_rate_limit_buckets, distributed_rate_limit_receipts, workspace_settings, organization_command_idempotency | 不可变审计、分布式限流、配置和幂等 |
| 历史兼容 | attendance, leave_requests | 不在当前产品范围；不得开放页面/API |

## Sensitive data

高度敏感：私档、薪资、报销凭证、身份/OAuth、AI 对话和文件内容。敏感：客户联系人、合同、成员关系、审批和 Agent 日志。导出需独立权限、水印、原因、过期时间和审计；日志/证据不得包含令牌、Cookie、连接串、手机号、工资明细或文档正文。

