# Projects

项目协同中心的领域边界，包含企业目标、项目、项目成员、里程碑、任务、评论、项目动态、项目风险、文件关联与日报。

- `types.ts`：前端领域类型、状态枚举和页面聚合契约。
- `mock-data.ts`：关联完整的 Mock 实体、项目列表/详情选择器和组合筛选函数。
- `projects-page.tsx`：`/projects` 的服务端组合入口。
- `projects-workspace.tsx`：项目列表页面的搜索、分组、筛选、本地项目合并与新建项目入口。
- `project-detail-page.tsx`：`/projects/[id]` 的详情页组合入口，并解析浏览器本地创建的项目。
- `project-detail-workspace.tsx`：统一持有当前项目聚合，协调概览、里程碑、任务与后续 Tab 占位状态。
- `data/mock-project-repository.ts`：版本化 Mock 仓库，使用租户、登录用户和成员命名空间保存完整项目聚合并支持刷新恢复；未显式绑定的身份不能读取或写入本地夹具。
- `data/project-list-operations.ts`：本地项目与默认列表的覆盖合并、稳定排序和组合统计增量计算。
- `data/project-task-operations.ts`：任务创建、三态更新与项目完成比例自动计算的纯业务操作。
- `data/project-list-data.ts`：Supabase 项目、负责人、成员、目标与里程碑列表装配，失败时自动回退 Mock。
- `data/project-member-data.ts`：复用 `organization_members`、`employee_profiles` 和 `departments` 的成员展示信息装配。
- `data/project-detail-data.ts`：Supabase 详情关联查询与不可用状态下的 Mock 回退。
- `components/`：统计、筛选、列表、详情、新建项目、里程碑、项目任务、新建任务、右侧提醒和移动端底部导航。
- 页面规划：`docs/product/projects-module-page-plan.md`。

V1.0 功能完善阶段继续采用 Mock 数据，并在不改动现有 Supabase 读取层的前提下完成以下演示闭环：新建项目 → 打开项目详情 → 创建并分配任务 → 更新待开始/进行中/已完成状态 → 按已完成任务比例自动更新项目进度。新建项目、任务和进度覆盖会持久化到当前浏览器；甘特图、文件、日报与复盘继续保持占位。Supabase 配置、登录认证和权限逻辑未在本阶段修改。
