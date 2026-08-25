# QuantXY 企业工作站商用级上线审计报告

审计日期：2026-08-25
审计范围：当前仓库 `E:\新企业工作站`、Next.js 应用、单页融合工作台、Supabase 迁移、环境变量、测试与构建脚本、线上工作台只读冒烟。

## 1. 总结论

当前版本已经具备“内部试运行 / 受控演示 / 小范围真实任务流转”的基础，但还不能直接定义为“外部商用级全模块上线版本”。

核心原因不是 UI 好不好看，而是项目里还混合存在三套形态：

1. Next.js 正式应用路由。
2. `quantxy-ai-workbench-fused.html` / `public/quantxy-ai-workbench-fused.html` 单页融合工作台。
3. Supabase 真实数据线路 + mock/localStorage/sessionStorage 演示线路。

商用版必须做到：用户看到的每个入口，要么真实可用、真实鉴权、真实落库、可审计、可恢复；要么暂时不显示。不能让客户进入“看起来能用、实际不落库”的半演示状态。

## 2. 已验证通过的工程项

本轮已验证：

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| `npm run test` | 通过 | 109 个 Vitest 文件、728 条测试通过；HTML 行为测试 97 条通过 |
| `npm run typecheck` | 通过 | TypeScript 编译检查通过 |
| `npm run lint` | 通过 | lint 脚本已内置 Node 4096MB 堆内存，不再需要手动设置 `NODE_OPTIONS` |
| `npm run build` | 通过 | Next.js 生产构建通过，生成 27 个页面 |
| `npx supabase migration list --db-url ...` | 历史通过 / 新迁移待应用 | 此前远端同步到 `202608210003`；本轮新增 `202608250001`、`202608250002`，需先上 staging 再上 production |
| 线上工作台只读冒烟 | 基本通过 | Agent 中心、AI 助理、薪酬、项目、任务、员工工作台入口可打开，无前端 console 报错 |

需要注意：`npm run test:e2e` 当前失败，原因是测试保护逻辑要求 E2E 只连接本机 Supabase，但当前 `.env.local` 指向远端库。这是安全保护，不是业务断言失败；商用前必须补独立 staging/e2e 数据库。

## 2.1 本次 P0 整改已完成项

本报告生成后，已在 `codex/commercial-p0-hardening` 分支完成第一批商用化底座整改：

| 整改项 | 状态 | 说明 |
| --- | --- | --- |
| 生产模式禁止项目 mock 回退 | 已完成 | `loadProjectList()` 与 `loadProjectDetail()` 默认改为生产 fail-closed；只有非生产或显式开启 `WORKSTATION_ALLOW_MOCK_DATA=true` 时才允许 mock |
| demo auth 隔离 | 已完成 | 新增 `WORKSTATION_DEMO_ENABLED`，未显式开启时 `/api/demo-auth/*` 不会接受演示账号配置 |
| Agent 中心正式入口 | 已完成 | 正式模式下 AI 助理和 Agent 中心都保留入口；客户、活动、洞察、知识等未真实化模块继续隐藏 |
| 窄屏标题竖排问题 | 已完成 | 融合工作台标题增加横向显示、省略和 1100px 换行布局规则 |
| lint 稳定性 | 已完成 | `npm run lint` 已改为直接用 4096MB Node 堆运行 ESLint |
| 环境示例与 compose 安全默认 | 已完成 | `.env.example` 与 `compose.yaml` 默认关闭 mock 与 demo auth |
| 薪资真实数据层 | 已完成 | `salary` 默认走 Supabase，补部门+职级展示、服务端按 viewer 收窄、奖金池/任务奖金迁移与核算引擎 |
| 审批/报账真实数据层 | 已完成 | `approvals` / `approval_steps` / `approval_actions` 读取 Supabase，新增 `expense_reports` 报账台账迁移 |
| Agent 中心真实化底座 | 已完成 | 新增 `agent_definitions`、`agent_permissions`、`agent_invocations`、`agent_execution_logs`，正式 bootstrap 会注入 Agent 目录与调用记录 |
| AI 调用审计 | 已完成 | Agent 中心触发 AI 调用时会通过服务端写入 `agent_invocations`，失败时不假装成功 |
| 知识库正式 bootstrap | 已完成 | `knowledge_documents` 已接入 `/api/workstation/bootstrap`，正式融合工作台可接收真实知识库摘要 |
| 敏感 route 防夹具泄漏 | 已完成 | 未绑定真实身份且无真库环境时，薪资/审批/员工 route 不调用 fixture loader；薪资数据层普通员工只返回本人记录 |

## 3. 当前最像“玩具”的风险点

### P0-1：正式产品入口不应再依赖单页融合 HTML

当前仓库仍有：

- `quantxy-ai-workbench-fused.html`
- `public/quantxy-ai-workbench-fused.html`
- `public/workstation-server-adapter.js`

融合 HTML 里还有大量 `localStorage`、`sessionStorage`、演示数据迁移、真实接口未配置提示、前端内存态 bootstrap 等逻辑。它能作为过渡壳，但不应作为长期商用主产品。

建议商用主线统一到 Next.js App Router，HTML 融合页只作为临时兼容入口或完全下线。

### P0-2：部分正式页面仍在直接返回 mock 数据

明确发现：

| 模块 | 文件 | 当前状态 |
| --- | --- | --- |
| 薪资 | `src/features/salary/salary-data.ts` | 已改为 Supabase 优先；非生产或显式 `WORKSTATION_ALLOW_MOCK_DATA=true` 才回退 mock |
| 审批 | `src/features/approvals/approval-data.ts` | 已改为 Supabase 优先；报账字段与审批步骤/动作会从真实表读取 |
| 考勤 | `src/features/attendance/attendance-data.ts` | 返回 mock 结果 |
| 客户 | `src/features/customers/customer-repository.ts` | 使用 localStorage + mock |
| 活动 | `src/features/activities/activity-mock-data.ts` | mock 聚合 |
| 分析 | `src/features/analytics/analytics-mock-data.ts` | mock 指标 |
| 知识库 | `src/features/knowledge/knowledge-mock-data.ts` | mock 文档 |
| Dashboard | `src/features/dashboard/data.ts` | 硬编码指标 |

薪资和审批已经进入真实数据线路，但仍需要 staging/e2e 闭环、财务复核 UI、附件与付款状态等完整验收。考勤、客户、活动、分析、知识库页面仍不能直接以商用级对外售卖；内部自用可以保留入口，但需要明确标注“待接入真实数据”或按权限隐藏。

### P0-3：项目中心生产回退 mock 风险已先行处理

项目列表和详情已经有 Supabase 查询层，但默认配置是失败时允许 mock fallback：

- `src/features/projects/data/project-list-data.ts`
- `src/features/projects/data/project-detail-data.ts`

本次 P0 整改已将默认策略改为：生产环境 fail closed，非生产或显式开启 `WORKSTATION_ALLOW_MOCK_DATA=true` 才允许 mock fallback。后续仍需把同样策略扩展到薪资、审批、考勤、客户、活动、分析、知识库等尚未真实化模块。

### P0-4：服务端密钥配置还不完整

当前 `.env.local` 有 Supabase URL、publishable key、DB URL 等，但本轮用 REST 管理请求检查时返回 401，且 `SUPABASE_SERVICE_ROLE_KEY` 长度明显不像标准 service role JWT 或可用服务端 secret。

商用前必须确认：

- `SUPABASE_SERVICE_ROLE_KEY` 是真实可用的服务端密钥。
- 只在服务端环境注入，不进入浏览器 bundle。
- 后台管理、AI 配置、飞书同步、批处理、数据审计脚本都能用它完成最小权限操作。

### P0-5：E2E 没有商用 staging 闭环

当前 E2E 被保护逻辑阻止连接远端库，这是对的。但商用上线必须有：

- 独立 staging Supabase。
- 独立测试 tenant。
- 可重复 seed / cleanup。
- CEO、负责人、员工、财务、HR 等角色的完整端到端用例。

否则只能证明“代码构建和单元行为测试通过”，不能证明“商用业务可交付”。

## 4. 模块商用成熟度评估

| 模块 | 当前成熟度 | 是否可内部用 | 是否可外部商用 | 主要缺口 |
| --- | --- | --- | --- | --- |
| 登录 / 权限 / RBAC | B | 可小范围 | 需补强 | 需生产 Feishu 配置、禁用 demo auth、补 API 鉴权覆盖 |
| 组织与员工 | B- | 可试用 | 需补强 | 缺员工导入、离职/停用、变更审计、职级体系配置台 |
| 员工画像 | B | 可试用 | 需补强 | 需要技能认证流、负责人确认、历史任务证据沉淀 |
| 项目中心 | B- | 可试用 | 不建议直接商用 | mock fallback、里程碑/文件/风险/评论未完全真实化 |
| 任务中心 | B | 可试用 | 需补强 | 任务通知、验收、幂等、并发、审计、飞书回执要强化 |
| AI 调度中心 | C+ | 可演示 | 不可直接商用 | 推荐逻辑要进一步落库、人工改派记录、资源利用率真实数据、依赖图视觉和布局优化 |
| AI 助理 | B- | 可试用 | 需补强 | 已接入 Agent 调用审计；仍需会话真实存储、知识库检索、权限引用、工具执行轨迹 |
| Agent 中心 | B- | 可试用 | 需补强 | 已有 Agent 表、权限、调用记录、bootstrap 注入；仍需管理端启停、版本发布、成本看板和权限配置 UI |
| 薪资 | B- | 可受控试用 | 需补强 | 已有部门+职级、奖金池迁移、核算引擎、服务端 viewer 收窄；仍需财务复核、工资批次、导出与发薪审批闭环 |
| 报账 / 审批 | C+ | 可受控试用 | 需补强 | 审批/报账已接 Supabase 与报账台账；仍缺附件上传、付款状态、预算占用和完整审批流配置 UI |
| 知识库 | C+ | 可试用骨架 | 需补强 | `knowledge_documents` 已进入正式 bootstrap；仍缺上传、版本、全文检索、权限、引用追踪和知识库管理页真实化 |
| 客户 / 活动 / 分析 | C-/D | 可展示 | 不可直接商用 | 多数仍为 mock/localStorage，未形成 CRM 和经营分析数据闭环 |
| 考勤 / 请假 | D+ | 不建议 | 不可直接商用 | 缺真实考勤来源、审批、异常处理、薪资联动 |
| 系统设置 | C+ | 可试用 | 需补强 | 组织级配置要落库，敏感配置需分权和审计 |

## 5. 你要的职级薪资 + 奖金池，商用版应这样落地

薪资不要再做“个人手写基础工资”。应拆成三层：

### 5.1 基础薪资规则

按部门 + 职级 + 岗位序列生成基础薪资：

- 部门：研发、产品、设计、运营、市场、财务、HR、管理层等。
- 职级：P1-P8 / M1-M6 / 专家序列。
- 薪资带：最低值、中位值、最高值。
- 员工工资：默认取所在部门与职级的薪资带，可由财务/CEO 在范围内调整。

### 5.2 项目奖金池

每个项目可以建立奖金池：

- 项目预算。
- 项目奖金池比例。
- 任务奖励预算。
- 里程碑奖金。
- 特别贡献奖金。
- 延期/返工/质量扣减规则。

项目资金不由老板随手分，而是由系统根据任务难度、优先级、验收质量、效率、角色权重、项目收益贡献计算建议分配。

### 5.3 自动核算公式

建议 V1 商用公式：

```text
月度应发 = 部门职级基础工资
        + 岗位/管理津贴
        + 任务绩效奖金
        + 项目奖金池分配
        + 特别贡献奖励
        - 请假/缺勤扣减
        - 质量返工扣减
        - 社保个税等代扣
```

系统自动计算建议值，财务复核，CEO/授权负责人最终审批，员工只看自己的薪资明细与核算依据。

## 6. Agent 中心应升级为真实中控台

你确认要的是 Agent 中心，不是 Agent Store。商用版应该保留 AI 助理，同时新增 Agent 中心。

Agent 中心至少要真实支持：

- Agent 目录：任务拆解、智能派单、飞书通知、员工画像、薪资核算、报账审核、知识库问答、项目复盘。
- 启用/停用。
- 权限范围：哪些部门、职级、角色可用。
- 调用记录：谁在什么时间用哪个 Agent 做了什么。
- 成本记录：模型、token、费用、耗时、成功/失败。
- 版本管理：提示词、工具配置、知识库范围、发布人。
- 审计：关键 Agent 动作必须有可追溯记录。

当前 `buildServerBootstrap()` 已经会把 `agent_definitions`、`agent_permissions`、`agent_invocations` 注入融合工作台，AI 对话在携带 `agent_public_id` 时也会通过服务端写入调用记录。下一步重点不是再做静态 UI，而是补 Agent 管理端：启停、权限范围调整、提示词版本发布、成本统计和异常告警。

## 7. 线上浏览器抽查发现的 UI 问题

线上工作台能打开核心入口，但在窄宽度视图下存在明显响应式问题：

- 页面标题可能被挤成竖排。
- 页面出现横向溢出。
- AI 调度中心部分卡片高度和空白区域过大。
- 任务依赖图横向过长，视觉观感不好。
- 方案对比区域应移动到任务拆解/下发之后，页面逻辑需要重新编排。

这些不是阻断数据库的 P0，但会影响专业感。商用版需要单独做响应式 QA。

## 8. 推荐整改路线

### 第一阶段：去玩具化底座

目标：所有正式入口真实、可鉴权、可失败闭环。

1. 正式环境关闭 mock fallback。
2. 禁用或隔离 demo auth。
3. 统一主产品入口，避免 HTML 融合页和 Next 页面并行割裂。
4. 补 API 鉴权测试，覆盖所有 middleware 放行 API。
5. 固化 `NODE_OPTIONS=--max-old-space-size=4096` 或拆分 lint 范围。
6. 修复窄屏标题竖排和横向溢出。

### 第二阶段：项目与任务真实闭环

目标：项目、任务、验收、通知、记录全部落库。

1. 项目列表/详情/创建/编辑全部 Supabase 化。
2. 里程碑、风险、文件、评论、日报、复盘全部真实化。
3. 任务下发、领取、执行、提交、驳回、验收全流程审计。
4. 飞书通知使用可靠 outbox/retry/回执。
5. 人工改派保留记录，反哺 AI 推荐逻辑。

### 第三阶段：财务与薪资专业化

目标：能支撑内部真实发薪和项目奖金分配。

1. 新增部门职级薪资规则表。
2. 新增项目奖金池、任务奖金事件、奖金分配记录。
3. 新增工资核算单、工资批次、财务复核、CEO 审批。
4. 新增报账系统：申请、附件、预算归属、审批流、付款状态。
5. 员工端只显示本人薪资、职级、部门、核算说明。

### 第四阶段：Agent 中心真实化

目标：企业内部 AI 中控台，而不是静态 UI。

1. 新增 Agent 表、能力表、权限表、调用日志表。
2. 每次 Agent 调用都记录用户、输入摘要、输出摘要、成本、结果。
3. Agent 可按部门/职级/角色授权。
4. Agent 可绑定知识库、飞书、任务、项目、薪资等真实工具。
5. AI 助理保留为对话入口，Agent 中心作为管理入口。

### 第五阶段：商用运维与交付 SOP

目标：能交给客户、能恢复、能审计、能收费。

1. 生产 / staging / e2e 三套环境隔离。
2. 每个客户独立 tenant，必要时独立 Supabase 项目或独立数据库。
3. 备份、恢复、迁移、回滚 SOP。
4. 日志、告警、错误追踪、性能指标。
5. 租户开通、停用、数据导出、数据删除流程。
6. 安全头、限流、CSRF、附件权限、审计日志。

## 9. 上线判断

如果目标是“内部自用试运行”，可以继续小范围上线，但要明确：

- 先开放项目、任务、员工画像、AI 助理、Agent 中心、薪资核算和报账/审批的受控试点。
- 考勤、客户、活动、分析、知识库管理页仍需按权限隐藏或标注真实化进度。
- 薪资和报账虽然已接真实数据层，但财务复核、附件、付款、导出、审批批次仍要走内部试运行验证。

如果目标是“外部客户商用交付”，当前版本还不能直接上线。最低上线门槛是：

- 关闭正式环境 mock fallback。
- 薪资、审批、知识库、Agent 中心真实后端已完成首版，但还必须完成 staging/e2e、管理端配置、附件/导出/审计闭环。
- E2E 有独立 staging 库并跑通。
- Demo auth 与生产 auth 严格隔离。
- 所有菜单入口按职级权限显示，不能用的直接不显示。
- 所有核心写入都有审计日志。
- 有备份恢复和客户数据隔离 SOP。

## 10. 建议的下一步执行顺序

我建议下一步不要再继续堆 UI，而是先做 P0：

1. 把新增迁移应用到 staging，再做一次只读结构盘点和角色冒烟。
2. 为薪资核算补财务复核/CEO 审批/工资批次 UI。
3. 为报账补附件、预算占用、付款状态和审批配置 UI。
4. 为 Agent 中心补启停、权限范围、提示词版本、成本看板和异常告警。
5. 补 staging/e2e 数据库与端到端测试。
6. 修复当前线上窄屏布局和 AI 调度中心信息架构问题。

这样做完，工作站才会从“可演示”进入“可内部真实使用”，再往商用交付推进会稳很多。
