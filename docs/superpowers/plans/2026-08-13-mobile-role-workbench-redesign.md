# Mobile Role Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一个网址中保留现有电脑端工作站，并在手机宽度自动启用极简移动端；统一四类岗位工作台、任务行动入口和演示身份切换，确保身份隔离、任务闭环与全部核心按钮可操作。

**Architecture:** 继续使用现有 Next.js 路由、演示数据与身份会话，不建立第二套站点或第二套业务状态。页面通过现有响应式壳层和移动端组件在同一路由下切换展示；共用任务、审批、工资、考勤和项目数据。岗位工作台保持桌面端结构，在移动断点使用紧凑摘要、单列行动列表与按需展开的任务详情。演示身份选择改为底部面板，并在切换后进入该身份的正确落地页。

**Tech Stack:** Next.js 15、React 19、TypeScript、Tailwind/CSS、Radix Sheet、Vitest、Testing Library。

## Global Constraints

- 单一网址：电脑端与移动端共用路由、数据、身份和业务状态。
- 不新增平行移动站点，不复制业务逻辑，不改变权限模型。
- 保留当前 10 位演示人员；四种岗位代表四类工作台和权限模板，不缩减人员。
- 每个人只看到自己的执行任务和工资；负责人/审批人只看到职责范围内的审核事项。
- 手机宽度 360/390/430px 不出现横向滚动、裁切、字段堆叠或原生下拉菜单。
- 核心入口、整行任务、行动项、身份切换、审批和工资流程都必须可点击并到达正确目标。
- 所有功能修改先增加失败测试，再实施最小修复，最后执行全量验证。

---

## Task 1: 把岗位行动区改为单列、可点击、按优先级排序

**Files:**
- Modify: `src/features/operations/operation-action-inbox.tsx`
- Create or modify: `src/features/operations/operation-action-inbox.test.tsx`
- Modify: `src/app/globals.css`

- [ ] 编写测试：行动项按紧急、高、普通顺序展示，最多显示四项。
- [ ] 编写测试：每个行动项整行可点击，并指向对应任务、审批、工资或考勤目标。
- [ ] 运行 `npm test -- src/features/operations/operation-action-inbox.test.tsx`，确认测试因现有网格卡片行为失败。
- [ ] 将行动区改为单列列表，使用红/橙/蓝优先级色条、短状态文案和唯一主操作。
- [ ] 为移动端补充不换行溢出、文本截断和触控高度样式。
- [ ] 再次运行目标测试并确认通过。

## Task 2: 重构岗位工作台顶部摘要和任务展开方式

**Files:**
- Modify: `src/features/operations/role-workbench.tsx`
- Modify: `src/features/operations/role-workbench.test.tsx`
- Modify: `src/app/globals.css`

- [ ] 编写测试：岗位工作台显示当前身份、岗位、待处理、进行中、已完成和需关注统计。
- [ ] 编写测试：员工仅出现本人任务；负责人审核事项与本人执行任务分区，不重复。
- [ ] 编写测试：任务行点击后展开直接操作区域，再点击其他任务时切换展开目标。
- [ ] 运行 `npm test -- src/features/operations/role-workbench.test.tsx`，确认新增测试失败。
- [ ] 将移动端头部改为紧凑身份卡、横向状态摘要和单条上下游说明。
- [ ] 把执行任务改为摘要行 + 单项展开详情；保留现有任务开始、提交、验收和附件闭环逻辑。
- [ ] 保留电脑端可读布局，并通过断点样式让同一路由在手机端自动切换。
- [ ] 再次运行目标测试并确认通过。

## Task 3: 将演示身份原生下拉改为移动底部选择面板

**Files:**
- Create: `src/features/mobile-workstation/components/mobile-identity-sheet.tsx`
- Modify: `src/features/mobile-workstation/mobile-profile-page.tsx`
- Modify: `src/features/mobile-workstation/mobile-core-pages.test.tsx`
- Modify: `src/app/globals.css`

- [ ] 编写测试：点击“切换演示身份”打开底部面板，而不是浏览器原生下拉。
- [ ] 编写测试：面板显示当前身份勾选状态及各身份姓名、部门、职位。
- [ ] 编写测试：选择新身份后调用会话切换，并跳转到该身份的 `landingPath`。
- [ ] 运行 `npm test -- src/features/mobile-workstation/mobile-core-pages.test.tsx`，确认新增测试失败。
- [ ] 使用现有 `Sheet` 组件实现底部身份面板，增加紧凑当前身份入口和大触控列表项。
- [ ] 删除旧 `.mobile-identity-switcher select` 样式，补充底部安全区和窄屏布局。
- [ ] 再次运行目标测试并确认通过。

## Task 4: 验证单网址响应式切换与角色隔离

**Files:**
- Modify as needed: `src/features/mobile-workstation/mobile-core-pages.test.tsx`
- Modify as needed: `src/features/operations/role-workbench.test.tsx`
- Modify as needed: `src/features/operations/role-access.test.ts`
- Modify: `design-qa.md`

- [ ] 增加回归测试：同一路由下移动端入口与桌面端业务目标一致。
- [ ] 增加回归测试：10 位身份在 CEO、负责人、普通员工、财务、人事四类工作台中的任务和工资入口均符合角色范围。
- [ ] 运行 `npm test -- src/features/mobile-workstation/mobile-core-pages.test.tsx src/features/operations/role-workbench.test.tsx src/features/operations/role-access.test.ts`。
- [ ] 运行 `npm run typecheck` 与 `npm run lint`，修复所有新增问题。
- [ ] 运行 `npm test` 与 `npm run build:demo`，确认全量通过。
- [ ] 在 360、390、430px 宽度检查首页、任务、项目、审批、我的、岗位工作台、工资和 AI 决策入口，记录结果到 `design-qa.md`。
- [ ] 验证桌面宽度仍使用现有网页端布局，移动宽度自动进入移动端且无横向滚动。

## Task 5: 清理、提交和发布准备

**Files:**
- Delete after verification: `.qa-*.png`
- Review: all modified source and test files

- [ ] 删除明确的临时 QA 截图，不触碰用户素材或其他未关联文件。
- [ ] 检查 `git diff --check` 与 `git status --short`。
- [ ] 提交实现改动，提交说明突出“单网址响应式移动工作台、身份切换和交互闭环”。
- [ ] 推送 `codex/customer-demo` 分支。
- [ ] 如 GitHub Pages 发布流程可用，执行现有发布流程并验证公开网址；否则明确说明仍需的仓库设置步骤。
