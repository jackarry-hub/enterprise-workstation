# 企业工作站一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立企业工作站可扩展前端基础，并交付符合设计稿的响应式 Dashboard。

**Architecture:** 使用 Next.js App Router 与 Server Components 作为默认边界，交互导航和图表作为小型 Client Components。业务代码按 `features` 聚合，Shadcn 只提供可组合原子组件，Supabase 连接与数据库迁移独立放置。

**Tech Stack:** Next.js 14+、TypeScript、Tailwind CSS、Shadcn UI、Lucide React、Supabase、PostgreSQL、Vitest、Testing Library、Playwright。

## Global Constraints

- 保持既有架构，不重新设计。
- 必须包含 dashboard、projects、tasks、activities、hr、attendance、salary、approvals 功能域。
- 必须包含 roles、files 数据表与六类角色种子数据。
- 必须实现 GlassCard、DataCard、StatusBadge、ProgressBar、PageHeader。
- 桌面端优先，同时支持移动浏览器响应式。

---

### Task 1: 项目与测试基础

**Files:**
- Create: `package.json`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

**Interfaces:**
- Produces: Next.js App Router 项目、`npm test`、`npm run build`。

- [ ] 使用 create-next-app 在当前工作区生成 TypeScript、App Router、Tailwind 与 ESLint 配置。
- [ ] 安装 Vitest、Testing Library、jsdom、Supabase、Lucide、Recharts 与 Shadcn 所需依赖。
- [ ] 配置 `test` 与 `typecheck` 脚本并运行空测试验证工具链。

### Task 2: Supabase 与数据库权限边界

**Files:**
- Create: `.env.example`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/env.ts`
- Create: `supabase/migrations/202608030001_initial_foundation.sql`
- Test: `src/lib/supabase/env.test.ts`

**Interfaces:**
- Produces: `getSupabaseBrowserClient()`、`getSupabaseServerClient()`、`getSupabaseEnv()`。

- [ ] 先测试缺少环境变量时返回可理解的配置错误。
- [ ] 运行定向测试并确认因实现缺失而失败。
- [ ] 实现浏览器端与服务端 Supabase 客户端。
- [ ] 创建 organizations、organization_members、roles、member_roles、files 表、索引、RLS 和六类角色种子。
- [ ] 重新运行测试并确认通过。

### Task 3: UI 组件系统

**Files:**
- Create: `src/components/ui/glass-card.tsx`
- Create: `src/components/ui/data-card.tsx`
- Create: `src/components/ui/status-badge.tsx`
- Create: `src/components/ui/progress-bar.tsx`
- Create: `src/components/ui/page-header.tsx`
- Test: `src/components/ui/design-system.test.tsx`

**Interfaces:**
- Produces: `GlassCard`、`DataCard`、`StatusBadge`、`ProgressBar`、`PageHeader`。

- [ ] 先测试五个组件的可见内容、状态语义和无障碍进度属性。
- [ ] 运行定向测试并确认组件尚不存在导致失败。
- [ ] 使用语义化设计变量实现五个组件。
- [ ] 重新运行测试，随后重构重复样式并保持测试为绿。

### Task 4: 全局 Layout、Sidebar 与 Header

**Files:**
- Create: `src/config/navigation.ts`
- Create: `src/components/shell/app-sidebar.tsx`
- Create: `src/components/shell/workspace-header.tsx`
- Create: `src/components/shell/workspace-shell.tsx`
- Create: `src/app/(workspace)/layout.tsx`
- Test: `src/components/shell/workspace-shell.test.tsx`

**Interfaces:**
- Produces: `WorkspaceShell`，消费集中式 `navigationItems`。

- [ ] 先测试品牌、主导航、搜索入口、通知与用户信息可见。
- [ ] 运行定向测试并确认因 Shell 未实现而失败。
- [ ] 实现桌面固定侧栏、顶部 Header 和移动抽屉。
- [ ] 重新运行测试并确认通过。

### Task 5: Dashboard 页面

**Files:**
- Create: `src/features/dashboard/data.ts`
- Create: `src/features/dashboard/dashboard-page.tsx`
- Create: `src/features/dashboard/components/dashboard-overview.tsx`
- Create: `src/features/dashboard/components/project-health.tsx`
- Create: `src/features/dashboard/components/task-trend-chart.tsx`
- Create: `src/features/dashboard/components/work-panels.tsx`
- Create: `src/app/(workspace)/dashboard/page.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/features/dashboard/dashboard-page.test.tsx`

**Interfaces:**
- Produces: 设计稿一致的 `/dashboard` 页面，根路由重定向至该页面。

- [ ] 先测试欢迎文案、四个关键指标和三个主要业务区域。
- [ ] 运行定向测试并确认 Dashboard 未实现导致失败。
- [ ] 实现 Dashboard 数据、卡片、图表、待办、活动、公告、日程和动态。
- [ ] 重新运行测试并确认通过。

### Task 6: 验证与视觉校准

**Files:**
- Create: `tests/e2e/dashboard.spec.ts`
- Create: `playwright.config.ts`

**Interfaces:**
- Consumes: 完成后的 `/dashboard`。
- Produces: 桌面 1672 x 941 与移动端截图、交互和构建证据。

- [ ] 运行单元测试、类型检查与 ESLint。
- [ ] 运行生产构建。
- [ ] 启动应用并验证桌面、平板和移动视口无溢出。
- [ ] 将 1672 x 941 实现截图与设计参考逐项比较并修正。
- [ ] 验证移动侧栏、搜索入口和导航状态。
