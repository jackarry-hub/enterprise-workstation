# 量子星河 AI企业大脑 V1.0 渐进迁移设计

状态：已确认

适用项目：enterprise-workstation

目标企业：量子星河

设计日期：2026-08-10

## 1. 目标

在保留现有玻璃拟态视觉、页面结构和已完成交互的前提下，将当前以 Mock、localStorage 和 IndexedDB 为主的企业管理演示项目，渐进升级为量子星河内部可使用的 AI 企业操作系统。

V1.0 必须跑通以下核心闭环：

1. 老板通过飞书登录并输入经营目标。
2. AI 生成项目、里程碑、任务、负责人、期限和验收标准。
3. 老板检查并确认下发。
4. 管理层和员工在各自工作台执行、反馈、上传成果并提交验收。
5. 负责人完成验收，风险、延期和阻塞自动升级。
6. 老板在驾驶舱查看结果、风险、现金流摘要和 AI 建议。
7. 关键操作进入不可静默绕过的审计记录。

## 2. 已确认的产品决策

- V1.0 只服务量子星河一家企业，不提供企业注册、租户切换、套餐或多租户后台。
- 保留 organizations 和 organization_id，数据库只初始化一个量子星河组织。
- 使用 Supabase Cloud 新加坡区域提供 Auth、PostgreSQL、Storage 和托管备份。
- 香港 Ubuntu 22.04 服务器部署 Next.js、Nginx 和 n8n。
- 所有员工统一使用飞书登录，不开放邮箱密码注册。
- AI 模型采用厂商无关接口，不强制绑定 OpenAI、Claude 或 DeepSeek。
- Dify 负责知识库和知识检索，不作为项目、任务和权限的事实数据源。
- n8n 负责通知和外部自动化，不直接拥有核心业务状态。
- LangGraph 不进入 V1.0；当出现长时间运行、可暂停恢复的复杂 Agent 工作流后再单独评估。
- 当前浏览器中的演示项目、任务、文件和身份数据不迁入正式数据库。
- 现有页面全部保留并完善内容，但不扩展为复杂 ERP、CRM 或 OA。
- 不开发独立移动端 App，继续提供响应式网页。

## 3. 当前代码基线

### 3.1 可以复用

- Next.js 15 App Router、React 19、Tailwind、Shadcn 和现有 UI 组件。
- Dashboard、项目、任务、活动、组织人事、考勤、请假、薪资、审批、客户、分析、知识和设置页面。
- Supabase 浏览器端与服务端客户端。
- organizations、organization_members、roles、permissions、member_roles 和 role_permissions。
- departments、employee_profiles、projects、project_members、milestones、tasks 和 files。
- decision_commands、department_work_orders、task_dependencies、support_requests、knowledge_documents 和 audit_events。
- 现有项目、人事等 Supabase 读取映射代码和完整测试基础。
- workbench-files Storage bucket 与已有 Storage RLS 骨架。

### 3.2 必须替换

- DemoSessionProvider 和本地角色切换。
- 只在前端隐藏页面的 RoleAccessGuard。
- operations-data、decision-workbench-data、mock-project-repository、customer-repository 和 settings-session 的 localStorage 写入。
- file-storage 的 IndexedDB 和内存回退。
- Supabase 读取失败后自动显示 Mock 数据的生产行为。
- 固定规则式 AI 拆解和预置演示结果。
- 硬编码的老板、负责人、员工、财务和人事身份。

### 3.3 当前缺口

- 没有真实登录页、Supabase Auth 会话保护和飞书身份映射。
- 没有统一的 API/Server Action 写入边界。
- 没有 AI Provider、AI 调用审计或方案版本。
- 没有 n8n Webhook Outbox 和可靠重试。
- 没有 Docker、Nginx、部署、监控和备份核验配置。
- 部分 E2E 断言仍对应旧版 Dashboard 内容。

## 4. 使用体验原则

系统内部可以复杂，员工界面必须简单。

- 任务主状态只显示：待开始、执行中、待验收、已完成。
- 延期、风险和阻塞作为独立提醒，不要求用户在复杂状态中选择。
- 每个页面只突出一个主要操作。
- 不向普通员工展示 Agent、模型、Token、Webhook、RLS 等技术术语。
- 无权限的入口直接隐藏；直接访问时显示简短说明并返回岗位首页。
- 所有保存操作明确显示成功、失败或仍在处理中。
- AI 生成结果必须经过人工确认，AI 不直接下发项目或任务。
- 桌面端保持现有白色、浅蓝渐变、透明卡片和大圆角；移动端以完成任务为主，不复制复杂桌面布局。

岗位导航边界：

- 老板：驾驶舱、AI战略、项目、风险、数据、知识。
- 管理层：部门、项目、任务、验收、团队。
- 员工：我的工作、任务、文件、考勤、请假。
- 财务：财务工作台、薪资、预算协同、审批。
- 人事：人事工作台、组织、考勤、请假、薪资复核。

## 5. 总体架构

用户请求链路：

    飞书扫码
      -> Supabase Auth 自定义飞书 OAuth
      -> Next.js Server Component / Route Handler / Server Action
      -> PostgreSQL + RLS
      -> Supabase Storage

AI 链路：

    AI战略中心
      -> Next.js AI Gateway
      -> 当前启用的 AI Provider
      -> 结构化方案校验
      -> 人工确认
      -> 数据库事务写入 Project、Milestone、Task

自动化链路：

    业务事务
      -> integration_outbox
      -> n8n Webhook
      -> 飞书通知或外部流程
      -> delivery_attempts 记录结果

知识链路：

    Supabase 文件和知识元数据
      -> Dify 数据集同步
      -> Dify 检索
      -> AI Gateway 引用检索结果

## 6. 登录、用户和权限

### 6.1 飞书登录

Supabase Auth 配置 custom:feishu OAuth2 Provider，使用飞书授权、Token 和用户信息端点。由 Supabase Auth 处理 OAuth state、PKCE、会话签发、刷新和退出。

旧版自制 HMAC 会话 Cookie 设计不再实施。

### 6.2 用户模型

- auth.users 保存 Supabase 登录身份。
- organization_members 保存用户与量子星河的成员关系。
- employee_profiles 保存工号、姓名、头像、部门、职位、汇报关系和在职状态。
- member_roles 复用现有数据库角色代码：owner、admin、department_head、employee、finance、hr。
- 界面岗位映射为 owner = CEO、department_head = 管理层、employee = 普通员工、finance = 财务、hr = 人事；admin 是不出现在普通岗位导航中的系统管理角色。
- 新增 external_identities，保存 provider、provider_user_id、feishu_open_id、feishu_union_id、auth_user_id、organization_member_id、last_login_at。

飞书首次登录规则：

1. 根据 union_id 优先、open_id 次优查找已预置的员工身份。
2. 找不到员工档案时拒绝进入，并提示联系管理员开通。
3. 找到后绑定 auth.users 和 organization_members。
4. 停用或离职员工即使飞书授权成功，也不能读取业务数据。

### 6.3 权限模型

- 前端导航根据角色隐藏。
- Workspace Layout 在服务端验证会话和员工状态。
- Server Action 和 Route Handler 再次验证操作权限。
- PostgreSQL RLS 是最终数据边界。
- service_role 只允许出现在服务端管理任务，不进入浏览器 Bundle。
- AI 和 n8n 不能绕过用户权限直接修改任意业务数据。

## 7. 数据模型调整

### 7.1 复用而不重复建表

不新增简化版 public.users、audit_logs 或重复 files 表。

- 用户：auth.users + organization_members + employee_profiles。
- 审计：audit_events。
- 文件：files + storage.objects。

### 7.2 组织

departments 增加：

- leader_member_id
- description

保留 parent_department_id 构建树形组织。

### 7.3 项目

projects 增加：

- budget_amount
- currency，V1 固定默认 CNY
- acceptance_criteria
- result_summary

现有 planning、active、on_hold、completed、cancelled 作为数据库状态，界面映射为筹备中、进行中、已暂停、已完成、已取消。

### 7.4 任务

tasks 增加：

- acceptance_criteria
- result_summary
- reviewer_member_id
- submitted_at
- reviewed_at
- review_comment
- blocked_reason
- blocked_at
- risk_level
- risk_reason

主状态保持 todo、in_progress、in_review、done，并在界面显示待开始、执行中、待验收、已完成。

延期由 due_date 与当前时间自动计算。风险由 risk_level 表示。阻塞由 blocked_at 和 blocked_reason 表示。三者可以与主状态同时存在。

### 7.5 文件

- 文件二进制内容只进入 Supabase Storage。
- files 保存 bucket、object_path、文件名、类型、大小、上传者和业务实体关系。
- 对象路径以 organization_id、entity_type、entity_public_id 和文件 UUID 组成。
- 下载使用短期签名 URL。
- 单文件默认限制 30 MB。
- 删除采用软删除元数据并由后台任务清理对象。

### 7.6 经营快照

新增 financial_snapshots，用轻量方式支持老板驾驶舱现金流，不建设完整财务总账：

- period
- revenue_amount
- cost_amount
- cash_balance
- currency
- source
- recorded_by_member_id
- recorded_at

V1 支持财务人员手工录入或 CSV 导入；自动财务系统同步不在 V1。

### 7.7 AI 与 Agent

新增：

- ai_plan_runs：一次 AI 方案生成的输入、厂商、模型、状态、耗时、用量、错误和创建人。
- ai_plan_versions：每次生成或人工修改后的结构化方案快照。
- agent_definitions：战略、项目、财务、运营 Agent 的名称、职责、启用状态和提示词版本。
- agent_run_steps：Agent 运行步骤、输入摘要、输出摘要和状态。

API Key 不写入数据库，只保存在服务器环境或密钥管理服务中。

### 7.8 自动化

新增：

- integration_outbox：业务事务产生的待发送事件。
- integration_delivery_attempts：每次投递的时间、状态码、错误和重试次数。

业务写入和 outbox 事件必须在同一数据库事务中完成，避免业务成功但通知永久丢失。

## 8. 应用代码边界

每个业务域采用同一模式：

- types：页面使用的稳定领域类型。
- repository：Supabase 查询和映射，不包含 UI。
- actions：服务端写入、权限检查、事务和审计。
- selectors：纯函数统计和筛选。
- components：只处理展示和用户交互。

生产行为：

- DATA_MODE 固定为 supabase。
- 读取失败显示错误状态，不返回 Mock 数据。
- 写入失败不更新前端成功状态。
- Mock 数据只允许在单元测试、Story 或显式测试环境使用。

业务写入优先使用 Server Actions；OAuth、AI 流式输出、n8n Webhook 和需要明确 HTTP 协议的集成使用 Route Handlers。

## 9. 路由与现有内容影响

| 路由 | V1.0 内容 |
| --- | --- |
| /dashboard | 老板驾驶舱：公司健康度、项目进度、现金流、风险、待决策项和 AI 建议 |
| /ai-center | 新增 AI战略中心：输入目标、生成方案、人工修改、确认下发 |
| /agents | 新增 Agent 管理：四类 Agent、启用状态、职责、运行记录，仅管理员可见 |
| /projects | 保留现有 UI，接入真实项目、成员、里程碑、预算、文件、日报和复盘 |
| /projects/[id] | 真实项目详情与权限控制，移除 localStorage 修改 |
| /tasks | 真实任务列表、风险标签、成果上传和验收入口 |
| /department | 负责人工作台，显示部门目标、人员负荷、阻塞和待验收 |
| /execution | 员工工作台，突出今天要做、待提交和被退回任务 |
| /finance | 预算协同、经营快照、薪资流程和待处理事项 |
| /hr | 员工、组织、考勤异常、请假和薪资复核 |
| /people | 真实员工目录、部门树、职位、角色和账号状态 |
| /knowledge | Supabase 文档元数据与 Dify 数据集状态、搜索和引用 |
| /analytics | 基于真实项目、任务、风险和经营快照的统计 |
| /notifications | 数据库通知、已读状态和业务跳转 |
| /activities | 保留基础活动推进，复用项目和任务数据模型 |
| /attendance | 保留现有考勤能力并接入真实用户和权限 |
| /leave | 保留简洁请假流程，不建设可配置流程引擎 |
| /payroll | 保留职责分离和工资单查看，不建设完整薪酬 ERP |
| /approvals | 只承载现有业务审批，不建设通用 OA 流程设计器 |
| /customers | 保留基础客户记录与跟进，不扩展复杂 CRM |
| /settings | 企业基础设置、个人偏好、角色查看和集成状态 |
| /help | 更新为 AI企业大脑真实使用说明 |

品牌统一修改为“量子星河 AI企业大脑”，清理旧版企业工作站标题、演示身份提示和虚构成功数据。

## 10. AI 战略中心

### 10.1 用户流程

1. 老板填写目标、期限、预算和约束。
2. AI Gateway 获取量子星河组织、人员、在执行项目和预算摘要。
3. 当前 Provider 返回符合 StrategyPlanDraft Schema 的结构化结果。
4. 服务端验证负责人属于量子星河、日期有效、预算不超限、任务负责人唯一、依赖无环。
5. 页面展示目标、项目、里程碑、任务、负责人和验收标准。
6. 老板修改或重新生成。
7. 老板确认后，在一个事务中创建 decision_command、project、milestones、tasks、audit_events 和 integration_outbox。

### 10.2 模型无关接口

AI Gateway 对业务层公开：

- generateStrategyPlan
- reviseStrategyPlan
- summarizeExecution
- generateExecutiveAdvice

Provider 适配器负责不同厂商的鉴权、请求、流式输出、用量和错误映射。页面和业务表不保存厂商专属响应结构。

### 10.3 安全边界

- 模型输出只能形成草稿。
- 模型不能直接调用数据库写入工具。
- 确认下发必须由有权限的真实用户执行。
- 输入模型前过滤不必要的手机号、工资明细和飞书 Token。
- AI 输出和人工修改均保留版本与审计记录。

## 11. Agent 管理

V1.0 的战略、项目、财务和运营 Agent 是四种受控能力配置，不是可任意操作系统的自治员工。

- 战略 Agent：把目标拆为可衡量的经营方向。
- 项目 Agent：生成项目、里程碑、任务、依赖和验收标准。
- 财务 Agent：分析预算、经营快照和成本风险，不生成会计凭证。
- 运营 Agent：生成市场和内容行动建议，不自动对外发布。

管理员可以启用、停用和查看运行记录。普通员工只看到与自己任务相关的最终结果。

## 12. Dify、n8n 与飞书

### 12.1 Dify

- Dify 保存向量索引和检索工作流。
- Supabase 保存文档业务归属、权限、同步状态和 Dify 外部 ID。
- 文档上传后由后台同步到 Dify。
- 检索前在 Supabase 校验用户是否有权访问文档。
- Dify 返回的内容必须附带来源，AI 页面显示引用文档。

### 12.2 n8n

- n8n 只消费签名 Webhook。
- Webhook 使用时间戳、事件 ID 和 HMAC 签名。
- n8n 根据事件发送飞书通知。
- n8n 不使用 Supabase service_role 直接修改核心业务表。
- 回调通过专用受限接口更新 delivery_attempts。

### 12.3 飞书通知

V1.0 发送：

- 新任务通知。
- 任务被退回。
- 待验收提醒。
- 阻塞、延期和风险升级。
- 老板确认下发结果。

通知失败不回滚业务事务，由 outbox 重试并在集成状态页显示。

## 13. 错误处理

- 未登录：跳转飞书登录。
- 未开通账号：显示联系管理员，不自动创建无权限员工。
- 无权限：隐藏入口；直接访问返回岗位首页并说明原因。
- 数据读取失败：保留页面框架，显示重试按钮和请求编号。
- 数据写入失败：保留用户输入，不显示成功提示。
- 文件上传失败：显示失败原因并允许重新上传。
- AI 未配置：AI战略中心显示“管理员尚未配置 AI 服务”，其他模块正常使用。
- AI 超时或格式错误：不写数据库，允许重试或保存输入。
- n8n 失败：业务继续完成，事件进入重试。

错误日志不得包含 App Secret、service_role、AI API Key、飞书 Token、工资明细或文件签名 URL。

## 14. 安全与审计

- 所有公开业务表启用 RLS。
- 所有外键按 organization_id 保证同组织引用。
- 高敏感表按角色与本人范围限制。
- 薪资明细仅本人、财务、人事和已授权老板可见。
- audit_events 采用追加写入，普通业务角色不能更新或删除。
- 关键 Server Action 写入 actor、action、entity、before、after、request_id、IP 摘要和时间。
- Storage 路径与 RLS 同时校验组织和业务实体权限。
- 所有密钥仅存在服务器环境或密钥管理服务。
- 生产环境使用 HTTPS、安全 Cookie、CSP、速率限制和请求大小限制。

## 15. 部署

### 15.1 Supabase Cloud

- 区域：Singapore。
- 正式环境采用提供每日备份的付费计划。
- 开发和正式项目分离。
- 数据库变更只通过版本化迁移执行。

### 15.2 香港 Ubuntu

Docker Compose 运行：

- Next.js Web。
- n8n。
- 可选的轻量 Worker，用于 outbox 投递和 Dify 同步。

Nginx 负责：

- HTTPS。
- 域名和反向代理。
- 请求体限制。
- 安全响应头。
- Webhook 路由限制。

V1.0 不在香港服务器自托管 Supabase、PostgreSQL 或 Redis。没有经过验证的队列需求前不引入 Redis。

## 16. 渐进迁移阶段

### 阶段 1：Supabase、飞书登录、用户和权限

- 创建 Supabase Cloud 开发项目。
- 整理现有迁移并建立干净数据库。
- 配置 custom:feishu。
- 建立量子星河、部门、员工、身份和角色种子。
- 用真实服务端会话替换 DemoSession。
- 实现 Workspace 路由保护与 RLS 验证。
- 保持现有业务页面可浏览，不改变业务写入。

验收：五种岗位通过飞书进入各自工作台，越权访问被前端和数据库同时拒绝。

### 阶段 2：项目、任务、文件、审计和现有核心内容

- 建立统一 repository 和 Server Action 边界。
- 迁移项目、任务、里程碑、成果、验收、文件和日志。
- 移除这些模块的 localStorage 和 IndexedDB。
- 完善老板驾驶舱、负责人工作台和员工执行台。
- 接入经营快照。
- 修复旧版 E2E 文案断言。

验收：老板创建项目或下发已确认方案，员工执行并提交成果，负责人验收，老板查看真实结果。

### 阶段 3：AI战略中心和 Agent

- 新增 /ai-center 和 /agents。
- 实现 AI Gateway、Provider 接口、结构化 Schema 和调用审计。
- 实现方案生成、修改、确认和事务下发。
- 实现战略、项目、财务和运营四类受控 Agent。
- 没有 API Key 时提供清晰配置状态。

验收：配置任意一个支持的 Provider 后，老板完成目标到任务的真实 AI 闭环。

### 阶段 4：知识、自动化、飞书通知和其余现有模块

- 接入 Dify 知识库。
- 建立 outbox、n8n 和飞书通知。
- 完成人事、考勤、请假、薪资、审批、活动、客户、分析、设置和帮助的数据迁移与内容清理。
- 完成香港服务器部署、监控、备份演练和恢复演练。

验收：全部现有路由使用真实身份和数据库；通知可追踪；正式环境可以备份和恢复。

## 17. 测试与验收

必须包含：

- Schema 与迁移测试。
- RLS 五角色权限矩阵测试。
- 飞书 OAuth 回调、未开通、停用员工和退出测试。
- Repository 映射与错误测试。
- Server Action 权限、事务和审计测试。
- 文件上传、下载、越权和大小限制测试。
- AI 结构化输出、无效负责人、循环依赖、超预算和超时测试。
- n8n 签名、幂等、失败重试测试。
- Dashboard、项目、任务和角色工作台 E2E。
- 桌面和移动端可用性测试。
- 生产构建、容器健康检查和备份恢复演练。

非技术用户验收：

- 新员工不阅读说明，5 分钟内完成登录、找到任务、更新进度和提交成果。
- 老板在 10 分钟内完成输入目标、检查 AI 方案、确认下发和查看结果。
- 用户不需要理解模型厂商、RLS、Webhook 或数据库。

## 18. 发布与回滚

- 每个阶段独立上线和验收，不在一次发布中切换全部模块。
- 数据迁移先在开发 Supabase 执行，再在正式环境执行。
- 生产切换前导出逻辑备份并记录迁移版本。
- 每个模块通过功能开关从 mock 切到 supabase；正式启用后删除该模块的浏览器持久化代码。
- 不实施双写，避免 localStorage 与数据库产生两个事实来源。
- 阶段失败时回滚应用版本；数据库使用向前修复迁移，禁止直接修改已执行迁移。

## 19. V1.0 明确不做

- 多企业租户。
- 复杂 ERP 总账、采购和库存。
- 复杂 CRM 销售漏斗和营销自动化。
- 可配置 OA 流程设计器。
- 独立移动端 App。
- 自托管 Supabase。
- LangGraph 长时 Agent Runtime。
- AI 自动批准、自动下发或无人监督写入业务数据。

## 20. 完成定义

V1.0 完成必须同时满足：

- 所有正式页面使用真实飞书身份、Supabase 数据和 RLS。
- 生产代码不再以 localStorage 或 IndexedDB 保存业务数据和文件。
- 现有页面内容完成清理和真实数据接入。
- 老板目标到员工执行再到老板验收形成真实闭环。
- AI 模型可替换，未绑定单一厂商。
- 文件、审计、通知、知识和部署具备可操作证据。
- 类型检查、Lint、单元测试、E2E 和生产构建全部通过。
