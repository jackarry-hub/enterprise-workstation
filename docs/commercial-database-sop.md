# 量子星河企业工作站商用数据库 SOP

更新日期：2026-08-25

## 1. 当前数据库包含什么

当前系统的数据库设计以 Supabase/Postgres 为主，核心是“企业工作站业务库 + 飞书身份登录 + 多租户权限隔离 + 项目任务协同 + 薪资/报账/知识库/Agent 能力预留”。

### 1.1 企业、身份与权限

- `tenants`：租户/企业隔离边界。
- `organizations`：企业组织。
- `organization_members`：企业成员关系。
- `roles`、`permissions`、`member_roles`、`role_permissions`：RBAC 角色、权限、成员角色绑定。
- `identity_providers`、`external_identities`：飞书等外部身份来源与员工身份绑定。
- `audit_logs`、`audit_events`：审计日志，记录身份、权限、业务动作。

### 1.2 员工、部门、画像与职级

- `departments`：部门。
- `employee_profiles`：员工基础资料、岗位、部门、能力标签。
- `employee_work_profiles`：个人工作画像，如专业简介、偏好任务、成长方向、每周可投入工时、技能自评。
- `position_templates`：岗位/职级模板。
- `skill_categories`、`skill_tags`：技能分类与标签。
- `position_skill_requirements`：岗位所需能力。
- `employee_skills`：员工能力证据和技能匹配数据。

### 1.3 项目、任务与协同

- `objectives`：目标。
- `projects`：项目。
- `project_members`：项目成员。
- `milestones`：项目里程碑。
- `tasks`：任务。
- `task_comments`：任务评论。
- `daily_reports`：日报。
- `project_activities`：项目动态。
- `project_risks`：项目风险。
- `task_dependencies`：任务依赖关系。
- `task_notifications`：任务分配后的飞书通知队列。

### 1.4 薪资、奖金池、报账与审批

- `salary`：薪资记录。
- `salary_grade_policies`：部门 + 职级 + 岗位序列的基础薪资带、绩效系数和津贴规则。
- `project_bonus_pools`：项目奖金池，记录项目预算中可分配给任务贡献的奖金池。
- `task_bonus_allocations`：任务奖金分配记录，按任务难度、质量、效率、角色权重等形成个人奖金明细。
- `payroll_runs`：工资核算批次。
- `payroll_policies`：薪资政策，后续用于“部门 + 职级 + 岗位 + 奖金池”的可配置核算规则。
- `attendance`：考勤。
- `leave_requests`：请假。
- `approvals`、`approval_steps`、`approval_actions`：审批主表、审批步骤、审批动作。
- `expense_reports`：报账台账，记录报账类型、金额、项目归属、附件、审批单关联和付款状态。
- `support_requests`：支持/工单类请求，可扩展为报账、行政、财务入口。

### 1.5 文件、知识库与资料

- `files`：文件元数据。
- `file_relations`：文件与项目、任务、审批等业务对象的关联。
- `knowledge_documents`：企业知识库文档。
- Supabase Storage 相关策略：用于工作站文件存储和权限控制。

### 1.6 AI、Agent 与系统配置

- `ai_provider_configs`：AI 服务商配置，存储模型供应商、配置状态等。
- `agent_definitions`：企业内部已启用智能体目录。
- `agent_permissions`：Agent 调用权限，按组织、部门、角色、成员和最低职级控制。
- `agent_invocations`：Agent 调用记录，记录调用人、状态、模型、token、耗时、成本和输出摘要。
- `agent_execution_logs`：Agent 执行事件日志，用于审计和排障。
- `decision_commands`：决策指令。
- `department_work_orders`：部门工单。
- `tenant_initializations`：租户初始化状态。
- `directory_connections`、`directory_entity_links`、`directory_sync_runs`、`directory_sync_issues`：飞书通讯录/组织同步相关结构。

注意：Agent 中心已经补齐首版独立表结构，当前命名采用 `agent_definitions` 而不是 `agents`，避免和外部“商店/安装”语义混淆。后续重点是补管理端 UI、成本汇总、提示词版本发布和权限配置。

## 2. 当前线上库状态说明

已有初始化报告显示，远程 Supabase 当时完成了登录、用户、权限、组织身份和审计基础设施初始化；业务数据导入为 0 条。

已经确认过的系统初始化数据包括：

- `tenants`：1 条。
- `organizations`：1 条。
- `roles`：6 条。
- `permissions`：19 条。
- `role_permissions`：64 条。
- `departments`：5 条。
- `identity_providers`：1 条。

但是当前本地目录没有绑定 Supabase project ref，无法在本机直接读取线上实时行数。本轮新增了 `202608250001_compensation_bonus_expenses.sql` 与 `202608250002_agent_center.sql` 两个迁移，商用上线前必须先在 staging 执行，再重新做只读数据库盘点，确认线上实际迁移版本、表结构、RLS、索引和业务数据行数。

## 3. 商用版数据库应该放在哪里

### 推荐方案 A：继续使用 Supabase Cloud Pro 作为 V1 商用数据库

适合当前阶段：

- 系统已经按 Supabase Auth、Postgres、RLS、Storage、Service Role 设计。
- 你现在的业务重点是先跑通企业工作站、飞书登录、项目任务、薪资核算、Agent 中心。
- 团队不想一开始就承担完整数据库运维成本。

建议配置：

- 生产库：Supabase Cloud Pro，区域优先选 Singapore / ap-southeast-1。
- 应用服务器：阿里云香港 ECS/SWAS 或后续更正式的 ECS/容器服务。
- 文件：Supabase Storage 起步；如果后续转阿里云，则迁移到 OSS。
- 备份：开启每日备份；商用后尽快开启 PITR。
- 数据隔离：继续使用 `tenant_id` 做租户隔离。

### 方案 B：阿里云 RDS PostgreSQL + OSS

适合这些情况：

- 未来客户要求中国大陆数据驻留、等保、ICP、内网访问、审计合规。
- 财务、薪资、员工画像等敏感数据不允许放在境外区域。
- 需要和阿里云 ECS、VPC、日志、堡垒机统一管理。

代价：

- 需要替换或适配 Supabase Auth、RLS、Storage、Edge/API 调用方式。
- 当前代码很多地方默认使用 Supabase，因此迁移成本明显高于继续用 Supabase。

### 当前建议

V1 商用先用 Supabase Cloud Pro；如果后面确定面向中国大陆企业客户，再规划 V2 的阿里云 RDS PostgreSQL 迁移。

不要把商用数据库放在当前网页服务器本机 Docker 或本机 Postgres 里。商用库必须是独立托管数据库，有备份、恢复、权限、监控和扩容能力。

## 4. 商用上线数据库 SOP

### 阶段 0：环境分层

必须至少分三套：

- Dev：本地开发库。
- Staging：预发布验收库。
- Production：正式商用库。

禁止开发、测试、正式共用一个数据库。

### 阶段 1：生产数据库创建

1. 创建 Supabase Pro 项目或阿里云 RDS PostgreSQL 实例。
2. 固定区域，记录 project ref / region / 数据库版本。
3. 创建管理员账号并开启 MFA。
4. 配置网络访问限制、SSL、备份策略。
5. 所有密钥只放服务器环境变量，不进入 Git、截图、前端资源、聊天记录。

### 阶段 2：迁移与结构校验

1. 在 Staging 先执行全部 migration。
2. 跑结构检查：表、索引、RLS、函数、触发器。
3. 跑权限检查：CEO、负责人、员工、财务、HR、管理员分别登录。
4. 确认 `service_role` 只用于服务端和管理员脚本。
5. Staging 验收通过后，再对 Production 执行同一版本迁移。

### 阶段 3：基础数据初始化

1. 初始化租户 `quantxy`。
2. 初始化组织 `quantum-galaxy`。
3. 初始化部门、职级、角色、权限。
4. 导入员工名单，绑定飞书 `open_id` / `union_id`。
5. 初始化薪资政策：部门 + 职级 + 岗位基准工资。
6. 初始化奖金池规则：项目奖金池、任务贡献权重、质量验收权重、效率权重。

### 阶段 4：业务模块验收

必须逐项通过：

- 飞书登录。
- 职级权限菜单显示。
- 项目创建。
- 项目拆任务。
- AI 推荐人选 + 人工可改派。
- 飞书任务通知。
- 员工刷新后仍保留当前页面状态。
- 我的工作画像保存。
- 我的薪酬显示部门、职级、薪资档位。
- 财务/CEO 进入工资核算。
- 报账/审批流程至少完成一条闭环。
- 知识库可新增、检索、引用。
- Agent 中心可查看企业启用智能体、能力、权限、调用记录。

### 阶段 5：备份与恢复演练

1. 上线前做一次全量备份。
2. 上线后每天自动备份。
3. 商用后开启 PITR。
4. 每月至少做一次恢复演练，恢复到临时库，不覆盖生产库。
5. 记录恢复耗时、恢复点、负责人、验证结果。

### 阶段 6：商用发布

1. 冻结代码版本和数据库 migration 版本。
2. 部署应用。
3. 执行生产只读盘点。
4. 用 CEO、员工、财务、负责人四个角色做冒烟测试。
5. 确认日志无密钥、无 Token、无完整员工敏感信息。
6. 发布正式入口。
7. 保留回滚方案：应用回滚版本 + 数据库恢复点 + 负责人联系方式。

## 5. 商用前必须补齐的数据库能力

当前结构已经有基础，但商用前还建议补齐：

1. 奖金池首版已新增：`project_bonus_pools`、`task_bonus_allocations`；后续可再补 `task_reward_scores` 做评分明细。
2. 报账首版已新增：`expense_reports`；后续可再补 `expense_items`、`expense_attachments`、`expense_approvals` 做多明细、多附件和独立审批流。
3. Agent 中心首版已新增：`agent_definitions`、`agent_permissions`、`agent_invocations`、`agent_execution_logs`；后续补提示词版本表和成本汇总视图。
4. 知识库版本表：仍需补 `knowledge_document_versions`、`knowledge_access_logs`。
5. 薪资确认流：仍需补 `payroll_adjustments`、`payroll_confirmations`。
6. 数据导出审计：任何薪资、员工画像、项目收益导出都要落审计。

## 6. 一句话结论

当前数据库已经具备企业工作站的基础骨架：组织、成员、权限、项目、任务、考勤、审批、薪资、知识库、飞书通知和 AI 配置都有结构。

但商用版不能只靠现在的 demo 数据库状态直接上线。建议先继续使用 Supabase Cloud Pro 做 V1 商用生产库，先把新增迁移应用到 staging，跑通薪资核算、报账审批、Agent 调用审计和恢复演练后，再正式对外商用。
