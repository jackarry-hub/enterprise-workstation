# 企业工作站 V1.0 项目任务闭环设计

## 目标

在现有 `/projects/[id]` 项目详情中实现任务 Tab，让项目负责人可以拆解和分配任务，员工可以更新执行状态，管理者可以通过任务完成比例查看自动计算的项目进度。数据继续使用 Mock，并与“新建项目流程”共用版本化浏览器项目仓库。

## 范围

本功能包含：

- 将现有“任务”占位 Tab 替换为任务列表。
- 展示任务名称、负责人、截止时间、优先级和状态。
- 从项目详情打开“新建任务”弹窗。
- 创建任务并分配给现有项目成员。
- 在任务列表中更新任务状态。
- 根据已完成任务占全部有效任务的比例自动更新项目进度。
- 将任务和进度变化保存到浏览器 Mock 仓库，刷新后继续保留。
- 新建项目可以直接进入任务 Tab 创建第一条任务。

本功能不包含任务评论、子任务、附件、工时、任务中心跨模块联动、真实网络请求、Supabase 写入、登录或权限判断。

## 领域规则

页面只暴露三种执行状态，并复用现有 `ProjectTask.status`：

| 页面状态 | 模型状态 | 进度 |
| --- | --- | --- |
| 待开始 | `todo` | `0` |
| 进行中 | `in_progress` | 保留已有值；新任务首次进入设为 `50` |
| 已完成 | `done` | `100`，写入 `completedAt` |

从“已完成”退回其他状态时清空 `completedAt`。现有 `backlog` 显示为“待开始”，`in_review` 显示为“进行中”，`cancelled` 不计入项目进度分母且不在本阶段提供切换入口。

项目进度计算：

```ts
const effectiveTasks = tasks.filter((task) => task.status !== "cancelled");
const completedTasks = effectiveTasks.filter((task) => task.status === "done");
const progress = effectiveTasks.length === 0
  ? 0
  : Math.round((completedTasks.length / effectiveTasks.length) * 100);
```

任务创建和状态变化后同时更新 `project.progress` 与 `project.updatedAt`。项目进度达到 `100` 时不自动修改项目状态，避免在没有复盘和正式结项动作时误将项目关闭。

## 新建任务字段

| 字段 | 规则 | 默认值 |
| --- | --- | --- |
| 任务名称 | 必填，去除首尾空格 | 空 |
| 负责人 | 必填，只能选择当前项目有效成员 | 项目负责人 |
| 截止日期 | 必填，必须处于项目开始日期之后 | 项目截止日期 |
| 优先级 | `low`、`medium`、`high`、`urgent` | `medium` |
| 描述 | 可选，去除首尾空格 | 空 |

自动字段：

- `id`：使用 `crypto.randomUUID()`；测试环境可注入 ID 工厂。
- `organizationId`、`projectId`：来自当前项目。
- `reporterId`：当前演示用户；没有上下文时使用项目负责人。
- `status`：`todo`。
- `progress`：`0`。
- `sortOrder`：当前任务最大排序值加一。
- `createdAt`、`updatedAt`：创建时的 ISO 时间。

## 页面结构

任务 Tab 延续现有项目详情结构：

1. 顶部使用 `GlassCard` 展示任务总数、待开始、进行中、已完成四项摘要，并提供“新建任务”按钮。
2. 主任务列表继续使用 `GlassCard`，桌面端为轻量列表，移动端自然堆叠为任务卡片。
3. 每条任务包含任务名称和描述、负责人头像、截止日期、优先级 `StatusBadge`、状态选择控件。
4. 空任务项目显示现有企业级空状态和“创建第一条任务”按钮。
5. 项目详情头部原有“添加任务”按钮直接切换到任务 Tab 并打开新建任务弹窗。

## 组件与数据流

- `ProjectTasksTab`：只负责摘要、列表、空状态和状态更新事件。
- `CreateTaskDialog`：负责表单、校验、焦点恢复和提交事件。
- `project-task-operations`：提供纯函数 `createMockTask`、`updateMockTaskStatus` 和 `calculateProjectProgress`。
- `mock-project-repository`：保存完整 `ProjectDetailData` 覆盖记录；同一接口同时支持默认项目和浏览器新建项目。
- `ProjectDetailWorkspace`：持有当前项目聚合状态，把任务变化转换为新的详情聚合并保存；Header、Overview、Milestones 和 Tasks 都接收同一个最新详情。
- `ProjectsWorkspace`：读取本地覆盖记录后更新列表和统计，使详情中的进度变化返回列表后可见。

所有状态更新采用不可变数据更新；组件不直接解析或写入 `localStorage`。

## Mock 持久化一致性

浏览器存储键继续使用 `enterprise-workspace.projects.v1`。默认项目第一次发生任务写操作时，将当前完整 `ProjectDetailData` 写为本地覆盖记录。之后详情和项目列表都以同 ID 的本地记录为准。

为了让同一浏览器标签中的列表及时感知详情变化，仓库写入后派发自定义事件 `enterprise-workspace:projects-changed`。项目列表监听该事件并重新合并本地项目；不引入新的全局状态库。

## 错误处理

- 任务名称或负责人缺失：显示字段错误，弹窗保持打开。
- 截止日期早于项目开始日期：显示“任务截止日期不能早于项目开始日期”。
- 本地存储写入失败：任务和项目进度不更新，显示保存失败提示。
- 找不到任务：状态更新函数返回原项目聚合，不写入存储。
- 本地记录损坏：忽略损坏数据并继续显示默认 Mock。

## UI 约束

- 不改 Workspace Layout、Sidebar、Header、项目详情头部和既有 Tab 样式。
- 复用 `GlassCard`、`StatusBadge`、`Dialog`、`Tabs`、`Button`、`Select` 和 `Avatar`。
- 保持白蓝渐变、半透明卡片、柔和阴影、大圆角和现有语义色。
- 不新增看板、甘特图或密集表格。

## 测试与验收

### 领域测试

- 创建任务会生成完整 `ProjectTask` 并追加到正确项目。
- 负责人必须来自项目成员。
- 三种页面状态正确映射模型状态、进度和 `completedAt`。
- `cancelled` 不进入项目进度分母。
- 无任务时进度为 `0`，完成一半为 `50`，全部完成为 `100`。
- 状态更新和项目进度以单次聚合写入保存。

### 页面交互测试

- 点击任务 Tab 显示任务列表，不再显示占位文案。
- 项目头部“添加任务”会进入任务 Tab 并打开弹窗。
- 新建任务后列表和四项摘要同步更新。
- 把任务从待开始改为已完成后，任务状态和项目进度同步更新。
- 关闭弹窗恢复触发按钮焦点，非法输入保留弹窗并显示错误。

### 浏览器验收

- 1672 × 941 桌面视口完成新建项目、进入详情、创建任务和更新状态。
- 430 × 932 移动视口任务列表与弹窗无横向溢出。
- 刷新详情后任务和进度仍然存在。
- 返回项目列表后显示最新项目进度。
- 浏览器控制台无错误。

## 架构一致性说明

任务能力继续使用现有 `ProjectTask`、`ProjectDetailData` 和项目 feature 目录，不创建第二套任务模型。浏览器仓库实现的是 Mock 命令与查询适配层；未来恢复 Supabase 时，页面事件和领域操作可以保留，只替换持久化实现。
