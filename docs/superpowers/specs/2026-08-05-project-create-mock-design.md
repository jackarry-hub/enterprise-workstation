# 企业工作站 V1.0 新建项目 Mock 流程设计

## 目标

在不接入 Supabase、登录和权限系统的前提下，让 `/projects` 具备可连续演示的新建项目流程。新项目创建后立即出现在项目列表，可以进入 `/projects/[id]` 查看基础详情，并在刷新页面后继续保留。

## 范围

本功能只包含：

- 从项目列表打开“新建项目”弹窗。
- 填写并校验项目基础信息。
- 创建项目、项目负责人和初始成员关系。
- 更新项目列表与项目统计。
- 将项目详情保存到浏览器 Mock 仓库。
- 创建后进入对应项目详情。
- 刷新后恢复浏览器中已创建的项目。

本功能本身不包含项目编辑、后续添加成员、权限判断、真实网络请求或 Supabase 写入；创建任务由同批交付的《项目任务闭环设计》负责，并与本功能共用 Mock 项目仓库。

## 用户流程

1. 用户进入 `/projects`，点击右上角“新建项目”。
2. 页面打开复用现有 `Dialog` 的玻璃拟态表单。
3. 用户填写项目名称、项目描述、负责人、参与成员、开始日期、截止日期、优先级和初始状态。
4. 系统校验必填项以及开始日期不得晚于截止日期。
5. 系统自动生成项目公开 ID 和项目编号，初始进度设为 `0`，健康度设为 `on_track`。
6. 系统为负责人创建 `owner` 成员关系，为其他成员创建 `member` 关系。
7. 系统把完整项目详情保存到版本化浏览器 Mock 仓库，并即时更新列表和统计。
8. 创建成功后关闭弹窗并跳转 `/projects/[id]`，详情页展示刚创建的项目和成员。
9. 用户刷新项目列表或详情页，已创建数据仍然可读取。

## 表单字段

| 字段 | 规则 | 默认值 |
| --- | --- | --- |
| 项目名称 | 必填，去除首尾空格 | 空 |
| 项目描述 | 必填，去除首尾空格 | 空 |
| 项目负责人 | 必填，来源于现有 `mockMembers` | 当前演示用户张伟 |
| 参与成员 | 可选，可多选；负责人自动包含 | 空 |
| 开始日期 | 必填 | 当天 |
| 截止日期 | 必填，必须不早于开始日期 | 空 |
| 优先级 | `low`、`medium`、`high`、`critical` | `medium` |
| 初始状态 | 仅允许 `planning` 或 `active` | `planning` |

自动字段：

- `id`：使用浏览器 `crypto.randomUUID()`；测试环境使用可注入 ID 工厂。
- `code`：使用 `PRJ-年份-三位序号`，序号基于默认项目和本地项目的最大编号递增。
- `progress`：`0`。
- `health`：`on_track`。
- `organizationId`、`createdById`：复用当前 Mock 企业和演示用户。
- `createdAt`、`updatedAt`：创建时的 ISO 时间。

## 数据结构与存储

新增项目功能使用项目模块内部的 Mock 仓库，不修改 Supabase 数据访问层。

浏览器存储键：`enterprise-workspace.projects.v1`。

存储内容只保存用户创建或后续修改的项目聚合，不复制整套默认 Mock：

```ts
type LocalProjectRecord = {
  detail: ProjectDetailData;
  savedAt: string;
};

type LocalProjectStore = {
  version: 1;
  projects: LocalProjectRecord[];
};
```

读取列表时，将默认 `getProjectListMock()` 与本地项目转换后的 `ProjectListItem` 合并；同一项目 ID 以本地记录优先。详情页先使用现有服务端结果，服务端找不到时由客户端本地详情入口读取 Mock 仓库。

仓库需要提供以下稳定接口：

```ts
readLocalProjects(): ProjectDetailData[]
createLocalProject(input: CreateMockProjectInput): ProjectDetailData
findLocalProject(projectId: string): ProjectDetailData | undefined
clearLocalProjects(): void
```

`clearLocalProjects` 只作为测试和后续演示重置能力，不在本功能中新增可见按钮。

## 组件边界

- `CreateProjectDialog`：管理表单状态、校验信息、焦点恢复和提交反馈；不直接操作 `localStorage`。
- `mock-project-repository`：负责存储版本、序列化、容错、ID/编号生成和项目聚合创建。
- `ProjectsWorkspace`：持有当前项目列表状态，打开弹窗，接收新项目并更新列表与统计。
- `LocalProjectDetailPage`：当服务端没有匹配详情时读取本地记录，显示加载态、详情或友好的未找到状态。
- 现有 `ProjectList`、`ProjectStats`、`ProjectDetailWorkspace`、`Dialog`、`Input`、`Select`、`Button` 保持复用。

## 错误处理

- 必填字段缺失：在对应字段显示可访问的校验信息，弹窗保持打开。
- 日期范围错误：显示“截止日期不能早于开始日期”。
- 浏览器存储不存在或 JSON 损坏：视为没有本地项目，不影响默认 Mock 页面。
- 浏览器存储写入失败：显示“演示数据保存失败，请检查浏览器存储空间”，不向列表插入半成品项目。
- 未知详情 ID：展示项目未找到状态，不替换成其他默认项目。

## UI 约束

- 不修改 Workspace Layout、Sidebar、Header、项目列表和详情页现有视觉结构。
- 弹窗继续使用白蓝渐变、半透明背景、浅蓝边框、柔和阴影和大圆角。
- 桌面端使用两列表单组织日期和枚举字段；移动端自动变为单列。
- 不新增颜色，不使用传统后台表单样式。

## 测试与验收

### 领域测试

- 创建项目会生成合法的 `ProjectDetailData`。
- 负责人同时出现在成员关系中且角色为 `owner`。
- 额外成员不会重复负责人。
- 日期错误和缺少必填字段不会写入存储。
- 损坏的本地存储数据会安全回退为空集合。
- 项目编号在默认项目和本地项目基础上递增。

### 页面交互测试

- 点击“新建项目”打开弹窗并聚焦项目名称。
- 填写合法数据并提交后，列表出现新项目，统计项目总数增加。
- 通过筛选和搜索可以找到新项目。
- 取消或按 Escape 会关闭弹窗并恢复触发按钮焦点。
- 提交非法日期时显示错误且弹窗保持打开。

### 浏览器验收

- 1672 × 941 桌面视口完成创建并进入详情。
- 430 × 932 移动视口表单无横向溢出。
- 刷新后新项目仍存在。
- 浏览器控制台无错误。

## 架构一致性说明

本方案把持久化限制在项目业务模块内部，领域输出仍然使用现有 `ProjectListItem` 和 `ProjectDetailData`。未来恢复 Supabase 时，只需把 Mock 仓库实现替换为真实命令接口，页面组件和领域契约无需重写。
