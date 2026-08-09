# Next.js 15 Dashboard Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已批准的企业工作站驾驶舱固定到 Next.js 15 稳定版，并完成纯前端 mock 数据页面的设计稿一致性验收。

**Architecture:** 保持 App Router、Server Component 默认边界和现有 `features/dashboard` 聚合方式。只修改框架版本与 Dashboard 可见设计偏差，现有 Supabase 文件不参与本阶段运行数据流。

**Tech Stack:** Next.js 15.5.22、React 19、TypeScript、Tailwind CSS 4、Shadcn UI、Lucide React、Recharts、Vitest、Testing Library、Playwright。

## Global Constraints

- UI 设计稿优先级最高，不使用默认后台模板。
- 本阶段只完成前端，数据全部使用 mock。
- 不开发 Dashboard 之外的业务页面、接口或后端流程。
- 桌面设计基准为 1672 x 941，移动验收为 390 x 844。
- 当前目录不是 Git 仓库，因此本计划不执行提交步骤。

---

### Task 1: 固定 Next.js 15 稳定版

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `next@15.5.22` 与 `eslint-config-next@15.5.22` 的一致依赖树。

- [ ] 记录现有 `npm run test`、`npm run typecheck` 与 `npm run lint` 基线结果。
- [ ] 安装 `next@15.5.22` 和 `eslint-config-next@15.5.22`，保留符合 peer range 的 React 19。
- [ ] 用 `npm ls next eslint-config-next react react-dom` 验证实际解析版本。
- [ ] 阅读安装后 `node_modules/next/dist/docs/` 中与 App Router、Layout、Server/Client Component 相关的版本内文档。
- [ ] 运行类型检查、Lint、单元测试和生产构建，修复真实兼容错误。

### Task 2: 锁定 Dashboard 前端范围与设计稿文案

**Files:**
- Modify: `src/components/shell/app-sidebar.tsx`
- Verify: `src/features/dashboard/data.ts`
- Verify: `src/features/dashboard/dashboard-page.tsx`
- Test: `src/features/dashboard/dashboard-page.test.tsx`
- Test: `src/components/ui/design-system.test.tsx`

**Interfaces:**
- Consumes: `projectHealth`、`announcements`、`schedules`、`activityStages` 等 mock 常量。
- Produces: 只包含驾驶舱信息的 `/dashboard` 页面。

- [ ] 确认现有测试覆盖四张指标卡、项目健康度、活动推进、通知公告和即将日程。
- [ ] 确认 Dashboard 不读取 Supabase 或调用网络接口。
- [ ] 移除设计稿中不存在的 Sidebar 英文副标，保留 QuantXY 图形和“企业工作站”。
- [ ] 重新运行组件测试，确保 Layout、公共卡片和 Dashboard 内容保持完整。

### Task 3: 生产浏览器与视觉验收

**Files:**
- Verify: `tests/e2e/dashboard.spec.ts`
- Verify: `playwright.config.ts`
- Evidence: Windows 临时目录下的桌面与移动端 PNG 截图。

**Interfaces:**
- Consumes: 生产构建后的 `/dashboard`。
- Produces: 设计稿对比、响应式交互和截图证据。

- [ ] 运行 Playwright E2E，验证页面标题、主要驾驶舱区域和移动抽屉。
- [ ] 启动生产服务，在 1672 x 941 捕获完整桌面截图。
- [ ] 在 390 x 844 捕获移动首页和打开 Sidebar 后的截图。
- [ ] 检查横向溢出、框架错误层、浏览器控制台错误/警告和 Logo 加载状态。
- [ ] 同轮查看设计稿与最终截图，完成至少五项视觉一致性对照。
