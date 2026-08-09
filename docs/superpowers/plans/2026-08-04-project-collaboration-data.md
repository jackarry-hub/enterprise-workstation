# 项目协同中心数据基础实施计划

**目标：** 在不开发页面 UI 的前提下，完成项目协同中心的数据库、权限、TypeScript 契约、Mock 数据和页面规划。

**架构：** Supabase/PostgreSQL 负责租户隔离、引用完整性和最终权限控制；`src/features/projects` 负责前端领域契约与本地 Mock 数据。现有 `files` 表以 migration 扩展，不重复建表。

**技术栈：** PostgreSQL、Supabase RLS、TypeScript、Vitest。

## Task 1：领域规格与页面规划

**文件：**

- 新增：`docs/superpowers/specs/2026-08-04-project-collaboration-data-design.md`
- 新增：`docs/product/projects-module-page-plan.md`

- [ ] 固化八张业务表的关系、状态枚举和完整性约束。
- [ ] 固化管理员、项目负责人、成员的权限边界。
- [ ] 规划项目列表和七个项目详情 Tab，不创建路由代码。

## Task 2：Supabase migration

**文件：**

- 新增：`supabase/migrations/202608040001_project_collaboration.sql`

- [ ] 创建目标、项目、成员、里程碑、任务、评论和日报表。
- [ ] 扩展统一文件表，增加项目/任务关联。
- [ ] 添加组合外键、检查约束和查询索引。
- [ ] 创建项目查看/管理辅助函数与任务执行字段保护触发器。
- [ ] 开启 RLS，添加查询与写入策略并配置 authenticated 权限。

## Task 3：TypeScript 领域类型

**文件：**

- 新增：`src/features/projects/types.ts`

- [ ] 定义状态常量与联合类型。
- [ ] 定义八类实体的前端领域接口。
- [ ] 定义项目列表项和项目详情聚合类型。

## Task 4：Mock 数据（TDD）

**文件：**

- 新增：`src/features/projects/mock-data.test.ts`
- 新增：`src/features/projects/mock-data.ts`
- 修改：`src/features/projects/README.md`

- [ ] 先编写聚合、引用一致性和未知项目测试，确认测试因实现缺失而失败。
- [ ] 实现稳定、关联完整的企业目标、项目、成员、里程碑、任务、评论、文件和日报 Mock。
- [ ] 提供项目列表与详情选择器，并让测试通过。

## Task 5：验证与交付边界

- [ ] 运行项目模块测试、全量测试、TypeScript 类型检查和 lint。
- [ ] 静态检查 migration 中八类表/扩展、RLS、索引和权限函数。
- [ ] 确认没有新增或修改 `src/app/projects` 页面代码。
- [ ] 汇总交付物后暂停，等待 UI 开发确认。

