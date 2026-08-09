# 组织人事员工目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立员工目录数据库边界，并完成 `/people` 员工统计/列表/筛选与 `/people/[id]` 员工详情的 Demo V1 页面。

**Architecture:** 数据层以 `employee_profiles` 为员工主体，账号成员关系保持可选关联；页面采用服务端装配数据、客户端处理列表筛选，详情页按 `public_id` 查找。无 Supabase 配置时整页使用关联完整的 Mock 数据，避免真实身份与演示员工混用。

**Tech Stack:** Next.js 15.5 App Router、React 19、TypeScript、Tailwind CSS 4、Shadcn/Radix、Lucide React、Supabase/PostgreSQL、Vitest、Testing Library。

## Global Constraints

- 延续现有企业工作站的白蓝渐变、玻璃拟态、半透明卡片、大圆角和柔和阴影。
- 复用现有 Workspace Layout、Sidebar、Header 和公共 UI 组件。
- V1 只包含员工统计、员工列表、搜索筛选和员工详情。
- 不开发招聘、绩效、工资、部门管理页面、档案编辑和复杂权限。
- `organization_members` 只表示系统账号成员关系；`roles` 只表示权限角色。
- `/people/[id]` 使用 `employee_profiles.public_id`。
- 动态路由 `params` 使用 Next.js 15 的 Promise 形式并在服务端 `await`。

---

### Task 1: 员工目录数据库边界

**Files:**
- Create: `supabase/migrations/202608040003_employee_directory.sql`
- Create: `src/features/hr/migration-contract.test.ts`

**Interfaces:**
- Consumes: `organizations`、`organization_members`、`roles`、`is_organization_member()`、`has_organization_role()`。
- Produces: `departments`、`employee_profiles`、RLS 策略、同企业守卫触发器和查询索引。

- [ ] **Step 1: 写失败的 migration 契约测试**

测试读取最新 migration，验证 `departments`、`employee_profiles`、公开 UUID、员工状态约束、工号唯一索引、部门/状态索引、RLS 和角色写入策略存在。

- [ ] **Step 2: 运行契约测试并确认失败**

Run: `npm test -- --run src/features/hr/migration-contract.test.ts`

Expected: FAIL，因为 migration 文件和表定义不存在。

- [ ] **Step 3: 编写 migration**

实现两张表、约束、索引、`updated_at` 触发器、同企业守卫触发器、RLS 与授权。写权限限制为 `owner/admin/hr`，读权限为有效企业成员。

- [ ] **Step 4: 运行契约测试并确认通过**

Run: `npm test -- --run src/features/hr/migration-contract.test.ts`

Expected: PASS。

### Task 2: 员工目录类型与 Mock 数据

**Files:**
- Create: `src/features/hr/employee-types.ts`
- Create: `src/features/hr/employee-mock-data.ts`
- Create: `src/features/hr/employee-data.test.ts`
- Create: `src/features/hr/employee-data.ts`

**Interfaces:**
- Produces: `Department`、`EmployeeProfile`、`EmployeeDirectoryItem`、`EmployeeDirectoryFilters`、`EmployeeDirectoryResult`、`filterEmployees()`、`getEmployeeDetail()`、`loadEmployeeDirectory()`。

- [ ] **Step 1: 写失败的数据行为测试**

测试关联完整性、统计结果、姓名/工号/邮箱搜索、部门筛选、员工状态筛选和无效公开 ID 返回空值。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- --run src/features/hr/employee-data.test.ts`

Expected: FAIL，因为类型、Mock 数据和筛选函数不存在。

- [ ] **Step 3: 实现类型、Mock 和数据装配边界**

Mock 数据至少覆盖 8 名员工、6 个部门、4 种任职状态、已开通/未开通账号和直属负责人关系。`loadEmployeeDirectory()` 在未配置 Supabase 时返回整页 Mock。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- --run src/features/hr/employee-data.test.ts`

Expected: PASS。

### Task 3: /people 员工目录页

**Files:**
- Create: `src/app/(workspace)/people/page.tsx`
- Create: `src/features/hr/people-page.tsx`
- Create: `src/features/hr/people-workspace.tsx`
- Create: `src/features/hr/components/employee-stats.tsx`
- Create: `src/features/hr/components/employee-filters.tsx`
- Create: `src/features/hr/components/employee-list.tsx`
- Create: `src/features/hr/people-page.test.tsx`
- Modify: `src/config/navigation.ts`

**Interfaces:**
- Consumes: `EmployeeDirectoryResult`、`filterEmployees()`、公共 `PageHeader/GlassCard/DataCard/Avatar/Table/Input/Select/StatusBadge/Empty`。
- Produces: 可搜索筛选、可跳转详情的 `/people` 页面。

- [ ] **Step 1: 写失败的页面行为测试**

测试统计卡、员工列表、姓名搜索、部门筛选、状态筛选和 `/people/<public_id>` 详情链接。

- [ ] **Step 2: 运行页面测试并确认失败**

Run: `npm test -- --run src/features/hr/people-page.test.tsx`

Expected: FAIL，因为页面组件不存在。

- [ ] **Step 3: 实现服务端页面与客户端筛选**

服务端加载整页数据；客户端只持有筛选状态并用 `useMemo` 派生结果。桌面端采用设计稿的统计卡和轻量员工表格，移动端转换为易读员工卡片列表。

- [ ] **Step 4: 启用组织人事导航**

将 `/people` 的 `available` 改为 `true`，保持其余未开发导航不可用。

- [ ] **Step 5: 运行页面测试并确认通过**

Run: `npm test -- --run src/features/hr/people-page.test.tsx`

Expected: PASS。

### Task 4: /people/[id] 员工详情页

**Files:**
- Create: `src/app/(workspace)/people/[id]/page.tsx`
- Create: `src/app/(workspace)/people/[id]/loading.tsx`
- Create: `src/features/hr/employee-detail-page.tsx`
- Create: `src/features/hr/components/employee-detail-header.tsx`
- Create: `src/features/hr/components/employee-basic-info.tsx`
- Create: `src/features/hr/components/employee-organization-info.tsx`
- Create: `src/features/hr/components/employee-account-info.tsx`
- Create: `src/features/hr/employee-detail-page.test.tsx`

**Interfaces:**
- Consumes: `getEmployeeDetail(publicId)` 和员工目录统一数据契约。
- Produces: 员工基础信息、任职信息、直属负责人和账号角色信息详情页；无效 ID 调用 `notFound()`。

- [ ] **Step 1: 写失败的详情页面测试**

测试头像/姓名/工号/状态、联系方式、部门岗位、直属负责人、账号状态和系统角色。

- [ ] **Step 2: 运行详情测试并确认失败**

Run: `npm test -- --run src/features/hr/employee-detail-page.test.tsx`

Expected: FAIL，因为详情组件不存在。

- [ ] **Step 3: 实现详情页面和动态路由**

动态路由服务端 `await params`，通过公开 ID 装配详情；组件保持单页信息层级，不增加未批准 Tab 或编辑入口。

- [ ] **Step 4: 运行详情测试并确认通过**

Run: `npm test -- --run src/features/hr/employee-detail-page.test.tsx`

Expected: PASS。

### Task 5: 全量验证与视觉 QA

**Files:**
- Modify: `src/features/hr/README.md`
- Create: `design-qa.md`
- Create: `artifacts/people/people-desktop-1672x941.png`
- Create: `artifacts/people/people-mobile-430.png`
- Create: `artifacts/people/employee-detail-desktop-1672x941.png`

**Interfaces:**
- Produces: 可复查的验证结果和截图。

- [ ] **Step 1: 更新模块说明**

记录模型边界、页面路由、Mock/Supabase 策略和 V1 范围。

- [ ] **Step 2: 运行完整自动化验证**

Run: `npm test && npm run typecheck && npm run lint && npm run build`

Expected: 全部退出码为 0。

- [ ] **Step 3: 启动生产预览并验证核心交互**

验证 `/people` 搜索、部门筛选、状态筛选和详情跳转；检查控制台错误、404 资源和横向溢出。

- [ ] **Step 4: 桌面与移动端视觉对照**

将 `08_企业工作站_组织人事.png` 与桌面截图放在同一比较输入中，检查标题、四张统计卡、筛选栏、员工列表密度、卡片圆角、白蓝色彩和响应式结构。

- [ ] **Step 5: 写 design-qa.md**

记录源图、实现截图、视口、交互、控制台、差异修复历史和 `final result: passed`；若仍有 P0/P1/P2，则保持 `blocked` 并继续修复。
