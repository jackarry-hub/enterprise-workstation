# 企业工作站移动端优先版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把客户演示版重构为以 390 × 844 为基准的五页移动企业工作站，并保留个人任务、项目、审批和工资等现有演示入口。

**Architecture:** 保留 Next.js 路由与现有 mock/演示状态，在工作区壳层内替换为最大 430px 的移动应用画布。新增 `features/mobile-workstation` 作为移动页面与通用组件边界，页面层只做数据适配；首页与任务页共享同一个优先级排序函数，详情页继续走现有路由。

**Tech Stack:** Next.js 15、React 19、TypeScript、Tailwind CSS 4、Lucide React、Vitest、Testing Library。

## Global Constraints

- 视觉基准：`C:\Users\Administrator\.codex\generated_images\019ff3f5-26a9-7863-896e-73c4b2fa54a0\exec-26ea9da6-d3e3-4f82-bfd3-0214b76a0397.png`。
- 手机基准：390 × 844；同时适配 375 × 812、393 × 852、430 × 932。
- 五项底部导航固定为：首页 `/dashboard`、任务 `/tasks`、项目 `/projects`、审批 `/approvals`、我的 `/me`。
- 首页与任务排序固定为：逾期或紧急、然后高优先级、然后普通优先级，同级按截止时间升序。
- 员工任务和工资内容按当前身份隔离，不混入其他人的数据。
- 不新增后端依赖；本轮复用现有 mock、localStorage 演示状态和详情路由。
- 不制作桌面视觉稿；宽屏只居中承载移动应用画布。

---

### Task 1: 移动数据模型与优先级排序

**Files:**
- Create: `src/features/mobile-workstation/mobile-workstation-types.ts`
- Create: `src/features/mobile-workstation/mobile-priority.ts`
- Test: `src/features/mobile-workstation/mobile-priority.test.ts`

**Interfaces:**
- Produces: `MobileTaskItem`、`sortMobileTasksByPriority(items, today)`、`getMobilePriorityMeta(priority, overdue)`。

- [ ] **Step 1: Write the failing test**

覆盖“逾期普通任务排在未逾期紧急任务前、紧急排在高优先级前、同级截止时间更近者靠前”。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/mobile-workstation/mobile-priority.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Write minimal implementation**

用稳定权重和 ISO 日期比较实现排序，状态为完成或取消的任务不判定逾期。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/mobile-workstation/mobile-priority.test.ts`
Expected: PASS.

### Task 2: 移动应用壳层与五项导航

**Files:**
- Create: `src/features/mobile-workstation/components/mobile-app-frame.tsx`
- Create: `src/features/mobile-workstation/components/mobile-bottom-nav.tsx`
- Create: `src/features/mobile-workstation/components/mobile-top-bar.tsx`
- Modify: `src/components/shell/workspace-shell.tsx`
- Modify: `src/features/operations/role-access.ts`
- Modify: `src/app/globals.css`
- Test: `src/components/shell/workspace-shell.test.tsx`

**Interfaces:**
- Produces: `MobileAppFrame({children})` and pathname-aware `MobileBottomNav`.

- [ ] **Step 1: Write the failing test**

断言壳层显示“移动工作区”区域、五个导航链接，并允许所有角色访问五个核心路由。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/shell/workspace-shell.test.tsx src/features/operations/role-access.test.ts`
Expected: FAIL with missing mobile region or route access.

- [ ] **Step 3: Write minimal implementation**

移除桌面侧栏与桌面头部展示，将工作区限制为最大 430px，加入安全区底栏和移动背景。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/shell/workspace-shell.test.tsx src/features/operations/role-access.test.ts`
Expected: PASS.

### Task 3: 首页与任务页

**Files:**
- Create: `src/features/mobile-workstation/mobile-home-page.tsx`
- Create: `src/features/mobile-workstation/mobile-tasks-page.tsx`
- Create: `src/features/mobile-workstation/components/mobile-task-row.tsx`
- Modify: `src/features/dashboard/dashboard-page.tsx`
- Modify: `src/features/tasks/task-center-page.tsx`
- Test: `src/features/dashboard/dashboard-page.test.tsx`
- Test: `src/features/tasks/task-center-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 priority helpers and existing `useOperations()` / project mock data.
- Produces: clickable home metrics, priority-sorted “今日重点”, two-tab personal task list.

- [ ] **Step 1: Write the failing tests**

首页测试四个数据卡、最多三条重点任务、优先级标签和“查看全部待办”；任务测试双 Tab、个人隔离、4–5 行密度和直接办理链接。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/features/dashboard/dashboard-page.test.tsx src/features/tasks/task-center-page.test.tsx`
Expected: FAIL because old desktop content is still rendered.

- [ ] **Step 3: Write minimal implementation**

把现有运营任务与项目任务适配为 `MobileTaskItem`，按当前身份筛选，复用统一排序和状态标签。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/features/dashboard/dashboard-page.test.tsx src/features/tasks/task-center-page.test.tsx`
Expected: PASS.

### Task 4: 项目、审批与我的页面

**Files:**
- Create: `src/features/mobile-workstation/mobile-projects-page.tsx`
- Create: `src/features/mobile-workstation/mobile-approvals-page.tsx`
- Create: `src/features/mobile-workstation/mobile-profile-page.tsx`
- Modify: `src/features/projects/projects-page.tsx`
- Modify: `src/features/approvals/approvals-page.tsx`
- Create: `src/app/(workspace)/me/page.tsx`
- Test: `src/features/mobile-workstation/mobile-core-pages.test.tsx`

**Interfaces:**
- Consumes: existing `ProjectListResult`, `ApprovalResult`, workspace session and demo identity controls.
- Produces: mobile project cards, two-tab approval rows, personal profile entries and demo identity switch.

- [ ] **Step 1: Write the failing test**

断言项目卡只保留五个字段、审批双 Tab、我的四个功能入口与退出登录；个人工资链接存在。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/mobile-workstation/mobile-core-pages.test.tsx`
Expected: FAIL because the new pages do not exist.

- [ ] **Step 3: Write minimal implementation**

复用现有结果对象并按身份过滤；卡片和行全部绑定现有详情地址。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/mobile-workstation/mobile-core-pages.test.tsx`
Expected: PASS.

### Task 5: 构建、手机尺寸与视觉验收

**Files:**
- Modify: `design-qa.md`
- Modify as needed: mobile components and `src/app/globals.css`

**Interfaces:**
- Consumes: selected visual reference and the running local preview.
- Produces: `design-qa.md` with `final result: passed` or an explicit blocker.

- [ ] **Step 1: Run automated verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build:demo`
Expected: all exit 0.

- [ ] **Step 2: Open the selected reference and rendered app**

Inspect the selected 390 × 844 reference and capture the app at 375 × 812, 390 × 844, 393 × 852, and 430 × 932 in the user-approved browser.

- [ ] **Step 3: Verify core interaction path**

Check bottom navigation, task tabs, approval tabs, each list row, home CTA, project detail entry, profile entries, and demo identity switch.

- [ ] **Step 4: Write and resolve the mismatch ledger**

Record visual differences in `design-qa.md`; fix all P0–P2 issues and repeat screenshots until `final result: passed`.

