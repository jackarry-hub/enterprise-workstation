# Enterprise Workspace V0.9 Navigation Page Completion Implementation Plan

> **Required subskill:** Use `superpowers:test-driven-development` for every implementation task, `product-design:image-to-code` before writing each page UI, `build-web-apps:react-best-practices` while reviewing client boundaries, `build-web-apps:frontend-testing-debugging` for browser QA, and `superpowers:verification-before-completion` before the final report.

**Goal:** Complete `/tasks`, `/analytics`, `/knowledge`, `/customers`, and `/settings` as fully accessible, interactive Mock-backed pages while preserving the existing Enterprise Workspace architecture and faithfully following the five approved UI references.

**Architecture:** Keep every page inside the existing workspace route group and feature-module structure. `/tasks` and `/analytics` consume one shared effective-project selector that merges built-in project detail data with browser-local project overrides; `/knowledge` and `/customers` own lightweight Mock models and pure selectors; `/settings` keeps its existing feature and adds session-backed form state. UI components only consume typed view models and never parse storage directly.

**Tech Stack:** Next.js 15.5.22 App Router, React 19.2.4, TypeScript 5, Tailwind CSS 4, shadcn/Radix primitives, Lucide React, Recharts, Vitest, Testing Library, Playwright.

**Global Constraints:**

- Do not change the visual system or rewrite completed modules.
- Use only Mock/browser-session data; do not connect Feishu, Supabase, authentication, or permissions.
- Reuse `Workspace Layout`, `Sidebar`, `Header`, `GlassCard`, `DataCard`, `PageHeader`, `StatusBadge`, `ProgressBar`, `Table`, `Dialog`, `Tabs`, and the existing chart wrapper.
- Treat the extracted references in `tmp/v09-ui-reference/` as the authoritative layout source:
  - `/tasks` → `06-task-management.png`
  - `/analytics` → `14-analytics.png`
  - `/knowledge` → `12-knowledge.png`
  - `/customers` → `13-customers.png`
  - `/settings` → `15-settings.png`
- Preserve the card placement and visual rhythm of references 06 and 14 even though their embedded content headings differ from their target route semantics.
- No visible button may be inert; every new button must navigate, filter, reset, open/close a dialog, mutate Mock/session state, or show a visible result.
- At 430 × 932, do not introduce page-level horizontal scrolling; dense desktop tables become readable cards.
- The installed Next package does not contain `node_modules/next/dist/docs/`; follow verified project patterns and current TypeScript APIs rather than assuming undocumented conventions.
- The workspace has no initialized Git history. Verification and the final changed-file report replace commit steps in this plan.

---

## Task 1: Build the shared effective-project query layer

**Files:**

- Create: `src/features/projects/data/effective-project-details.ts`
- Create: `src/features/projects/data/effective-project-details.test.ts`
- Read/reuse: `src/features/projects/mock-data.ts`
- Read/reuse: `src/features/projects/data/mock-project-repository.ts`
- Read/reuse: `src/features/projects/types.ts`

### Step 1: Write failing merge tests

Cover three deterministic cases:

```ts
it("uses a local project to replace the default project with the same id", () => {
  const result = mergeEffectiveProjectDetails([defaultProject], [localProject]);
  expect(result).toEqual([localProject]);
});

it("keeps default projects and appends browser-created projects", () => {
  const result = mergeEffectiveProjectDetails([defaultProject], [createdProject]);
  expect(result.map((project) => project.project.id)).toEqual([
    defaultProject.project.id,
    createdProject.project.id,
  ]);
});

it("ignores malformed local input through the repository boundary", () => {
  expect(getEffectiveProjectDetails([])).toEqual(getDefaultProjectDetails());
});
```

Run:

```powershell
npm test -- src/features/projects/data/effective-project-details.test.ts
```

Expected: FAIL because the effective-project helpers do not exist.

### Step 2: Implement the minimal pure helpers

Expose typed functions with no React dependency:

```ts
export function getDefaultProjectDetails(): ProjectDetailData[];
export function mergeEffectiveProjectDetails(
  defaults: ProjectDetailData[],
  localProjects: ProjectDetailData[],
): ProjectDetailData[];
export function getEffectiveProjectDetails(
  localProjects?: ProjectDetailData[],
): ProjectDetailData[];
```

Merge by `project.id`, preserve default ordering, and append genuinely new local projects.

### Step 3: Re-run focused tests

```powershell
npm test -- src/features/projects/data/effective-project-details.test.ts
```

Expected: PASS.

---

## Task 2: Add typed task-center selectors and status mapping

**Files:**

- Create: `src/features/tasks/task-center-types.ts`
- Create: `src/features/tasks/task-center-selectors.ts`
- Create: `src/features/tasks/task-center-selectors.test.ts`
- Read/reuse: `src/features/projects/data/project-task-operations.ts`
- Read/reuse: `src/features/projects/types.ts`

### Step 1: Write failing selector tests

Test flattening, search, ownership, status groups, cancelled-task completion math, assignee distribution, and deadline sorting:

```ts
it("maps backlog and todo into the pending page group", () => {
  const items = selectTaskCenterItems(projects, { status: "pending" });
  expect(items.every((item) => ["backlog", "todo"].includes(item.task.status))).toBe(true);
});

it("treats in_review as in progress", () => {
  expect(toTaskCenterStatus("in_review")).toBe("in_progress");
});

it("excludes cancelled tasks from the completion denominator", () => {
  expect(calculateTaskCenterCompletionRate([doneTask, todoTask, cancelledTask])).toBe(50);
});

it("includes tasks assigned to or reported by the current project member", () => {
  const result = selectMyTaskItems(projects, viewerMemberId);
  expect(result.every((item) =>
    item.task.assignee_id === viewerMemberId || item.task.reporter_id === viewerMemberId,
  )).toBe(true);
});
```

Run:

```powershell
npm test -- src/features/tasks/task-center-selectors.test.ts
```

Expected: FAIL because the task-center types and selectors are absent.

### Step 2: Implement the typed view model

Define:

```ts
export type TaskCenterStatus = "all" | "mine" | "pending" | "in_progress" | "done";

export interface TaskCenterItem {
  project: ProjectDetailData["project"];
  task: ProjectTask;
  assignee: MemberSummary | null;
  reporter: MemberSummary | null;
}

export interface TaskCenterFilters {
  query: string;
  tab: TaskCenterStatus;
  projectId: string;
  assigneeId: string;
  priority: ProjectTask["priority"] | "all";
}
```

Keep all filtering and aggregation pure. Do not read `localStorage` in selectors.

### Step 3: Re-run focused tests

```powershell
npm test -- src/features/tasks/task-center-selectors.test.ts
```

Expected: PASS.

---

## Task 3: Implement `/tasks` from reference 06

**Files:**

- Create: `src/app/(workspace)/tasks/page.tsx`
- Create: `src/features/tasks/task-center-page.tsx`
- Create: `src/features/tasks/task-center-page.test.tsx`
- Create: `src/features/tasks/task-center-workspace.tsx`
- Create: `src/features/tasks/components/task-center-hero.tsx`
- Create: `src/features/tasks/components/task-center-summary.tsx`
- Create: `src/features/tasks/components/task-center-list.tsx`
- Create: `src/features/tasks/components/task-center-aside.tsx`
- Create: `src/features/tasks/components/task-detail-dialog.tsx`
- Modify only if required for reuse: `src/features/projects/data/project-task-operations.ts`

### Step 1: Load the image-to-code instructions and inspect reference 06

Use `product-design:image-to-code` before writing UI. Compare proportions, card order, icon containers, spacing, typography, glass opacity, radius, and responsive stacking against `tmp/v09-ui-reference/06-task-management.png`.

### Step 2: Write the failing page interaction test

Mock the local project repository and cover the approved workflow:

```tsx
it("filters tasks, opens detail, and persists a status update", async () => {
  render(<TaskCenterPage />);

  await user.type(screen.getByPlaceholderText("搜索任务或项目"), "用户增长");
  await user.click(screen.getByRole("button", { name: "查看任务详情" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("负责人");

  await user.click(screen.getByRole("button", { name: "标记为已完成" }));
  expect(saveLocalProject).toHaveBeenCalled();
  expect(screen.getByText("任务状态已更新")).toBeInTheDocument();
});
```

Also assert that “全部任务 / 我的任务 / 待开始 / 进行中 / 已完成” are visible and that an empty filter result exposes a reset button.

Run:

```powershell
npm test -- src/features/tasks/task-center-page.test.tsx
```

Expected: FAIL because the route and components do not exist.

### Step 3: Implement the reference-aligned page shell

Map reference 06 without changing its skeleton:

- Hero: task-center title, summary copy, search control, reference artwork treatment.
- First row: due-task summary, status-tab task panel, filter controls styled as the reference quick-action tiles.
- Second row: assignee distribution, deadline timeline, latest task/project activity.
- Bottom row: status shortcuts for all, pending, in-progress, and done.
- Desktop list uses the existing `Table`; mobile renders equivalent task cards.
- Task detail uses `Dialog`, `StatusBadge`, `Avatar`, and a status action group.

Subscribe to `PROJECTS_CHANGED_EVENT`, recompute the effective project set, and keep the current filters stable.

### Step 4: Persist task status through the existing project repository

When a detail action changes status:

1. Call the existing task status operation.
2. Recalculate project progress from eligible tasks.
3. Save the whole updated `ProjectDetailData` through `saveLocalProject`.
4. Update local state only after save succeeds.
5. Show success or failure feedback inside the page/dialog.

### Step 5: Run focused tests and type-check the feature

```powershell
npm test -- src/features/tasks/task-center-selectors.test.ts src/features/tasks/task-center-page.test.tsx
npm run typecheck
```

Expected: PASS with no client/server serialization errors.

---

## Task 4: Add analytics selectors derived from shared Mock data

**Files:**

- Create: `src/features/analytics/analytics-types.ts`
- Create: `src/features/analytics/analytics-mock-data.ts`
- Create: `src/features/analytics/analytics-selectors.ts`
- Create: `src/features/analytics/analytics-selectors.test.ts`

### Step 1: Write failing deterministic analytics tests

Cover summary metrics, time-range filtering, department filtering, employee ranking, risk reminders, delivery calendar, and trend stability:

```ts
it("derives project and task statistics from the effective project set", () => {
  const result = buildAnalyticsViewModel(projects, employees, { range: "month", department: "all" });
  expect(result.summary.projectCount).toBe(projects.length);
  expect(result.summary.taskCompletionRate).toBeGreaterThanOrEqual(0);
});

it("recalculates execution rows when a department is selected", () => {
  const result = buildAnalyticsViewModel(projects, employees, {
    range: "quarter",
    department: "技术研发部",
  });
  expect(result.executionRows.every((row) => row.department === "技术研发部")).toBe(true);
});

it("returns deterministic trend points for identical input", () => {
  expect(buildTrend(projects, "half_year")).toEqual(buildTrend(projects, "half_year"));
});
```

Run:

```powershell
npm test -- src/features/analytics/analytics-selectors.test.ts
```

Expected: FAIL because the feature does not exist.

### Step 2: Implement pure analytics construction

Use project/task/member data for project count, active projects, completion rate, active employees, execution rows, risk reminders, and delivery dates. Keep deterministic Mock trend seeds in `analytics-mock-data.ts`, not inside React components.

### Step 3: Re-run focused tests

```powershell
npm test -- src/features/analytics/analytics-selectors.test.ts
```

Expected: PASS.

---

## Task 5: Implement `/analytics` from reference 14

**Files:**

- Create: `src/app/(workspace)/analytics/page.tsx`
- Create: `src/features/analytics/analytics-page.tsx`
- Create: `src/features/analytics/analytics-page.test.tsx`
- Create: `src/features/analytics/analytics-workspace.tsx`
- Create: `src/features/analytics/components/analytics-summary.tsx`
- Create: `src/features/analytics/components/execution-table.tsx`
- Create: `src/features/analytics/components/trend-chart.tsx`
- Create: `src/features/analytics/components/risk-reminders.tsx`
- Create: `src/features/analytics/components/delivery-calendar.tsx`
- Create: `src/features/analytics/components/health-distribution.tsx`

### Step 1: Load image-to-code instructions and inspect reference 14

Keep its date/department filter, four-stat row, large left table, center trend card, right reminder card, calendar block, and lower distribution block. Replace only attendance semantics with analytics semantics.

### Step 2: Write the failing render/filter test

```tsx
it("updates all analytics regions when filters change", async () => {
  render(<AnalyticsPage />);
  expect(screen.getByText("员工执行情况")).toBeInTheDocument();
  expect(screen.getByText("项目推进趋势")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("时间范围"), "quarter");
  await user.selectOptions(screen.getByLabelText("部门"), "技术研发部");

  expect(screen.getByTestId("analytics-filter-summary")).toHaveTextContent("本季度");
  expect(screen.getByTestId("analytics-filter-summary")).toHaveTextContent("技术研发部");
});
```

Run:

```powershell
npm test -- src/features/analytics/analytics-page.test.tsx
```

Expected: FAIL.

### Step 3: Implement page and charts

Use the existing chart wrapper and Recharts primitives. Keep chart colors within the current blue, cyan, violet, and restrained green tokens. Empty datasets render fixed-height glass empty states so the reference layout does not jump.

### Step 4: Run focused verification

```powershell
npm test -- src/features/analytics/analytics-selectors.test.ts src/features/analytics/analytics-page.test.tsx
npm run typecheck
```

Expected: PASS.

---

## Task 6: Build the knowledge data model and `/knowledge` from reference 12

**Files:**

- Create: `src/app/(workspace)/knowledge/page.tsx`
- Create: `src/features/knowledge/knowledge-types.ts`
- Create: `src/features/knowledge/knowledge-mock-data.ts`
- Create: `src/features/knowledge/knowledge-selectors.ts`
- Create: `src/features/knowledge/knowledge-selectors.test.ts`
- Create: `src/features/knowledge/knowledge-page.tsx`
- Create: `src/features/knowledge/knowledge-page.test.tsx`
- Create: `src/features/knowledge/knowledge-workspace.tsx`
- Create: `src/features/knowledge/components/knowledge-hero.tsx`
- Create: `src/features/knowledge/components/category-grid.tsx`
- Create: `src/features/knowledge/components/document-panels.tsx`
- Create: `src/features/knowledge/components/document-preview-dialog.tsx`
- Create: `src/features/knowledge/components/knowledge-overview.tsx`

### Step 1: Load image-to-code instructions and inspect reference 12

Retain the hero search/folder artwork, six category cards, three upper content panels, and three lower overview panels.

### Step 2: Write failing selector and interaction tests

```ts
it("searches title, summary, and tags case-insensitively", () => {
  expect(filterKnowledgeDocuments(documents, { query: "项目", categoryId: "all", tag: "all" }))
    .toEqual(expect.arrayContaining([expect.objectContaining({ title: expect.stringContaining("项目") })]));
});
```

```tsx
it("filters by category and previews a document", async () => {
  render(<KnowledgePage />);
  await user.click(screen.getByRole("button", { name: "项目文档" }));
  await user.click(screen.getAllByRole("button", { name: "预览文档" })[0]);
  expect(screen.getByRole("dialog")).toHaveTextContent("作者");
  expect(screen.getByRole("dialog")).toHaveTextContent("更新时间");
});
```

Run:

```powershell
npm test -- src/features/knowledge/knowledge-selectors.test.ts src/features/knowledge/knowledge-page.test.tsx
```

Expected: FAIL.

### Step 3: Implement typed Mock data, selectors, and reference layout

Model categories, documents, tags, authors, views, summaries, and activities. Implement title/summary/tag search, category/tag filters, recent sorting, popular sorting, preview dialog, “查看全部” scope changes, and an empty result with reset.

### Step 4: Re-run focused verification

```powershell
npm test -- src/features/knowledge/knowledge-selectors.test.ts src/features/knowledge/knowledge-page.test.tsx
npm run typecheck
```

Expected: PASS.

---

## Task 7: Build the customer model and `/customers` from reference 13

**Files:**

- Create: `src/app/(workspace)/customers/page.tsx`
- Create: `src/features/customers/customer-types.ts`
- Create: `src/features/customers/customer-mock-data.ts`
- Create: `src/features/customers/customer-selectors.ts`
- Create: `src/features/customers/customer-selectors.test.ts`
- Create: `src/features/customers/customers-page.tsx`
- Create: `src/features/customers/customers-page.test.tsx`
- Create: `src/features/customers/customers-workspace.tsx`
- Create: `src/features/customers/components/customer-summary.tsx`
- Create: `src/features/customers/components/customer-list.tsx`
- Create: `src/features/customers/components/customer-side-panels.tsx`
- Create: `src/features/customers/components/customer-distributions.tsx`
- Create: `src/features/customers/components/customer-detail-dialog.tsx`
- Create: `src/features/customers/components/create-customer-dialog.tsx`

### Step 1: Load image-to-code instructions and inspect reference 13

Retain the title/new-customer top row, four-stat row, wide left customer list, stacked right funnel/reminder/activity panels, and three lower distribution panels.

### Step 2: Write failing selectors and workflow tests

```ts
it("filters customers by query, status, source, and industry together", () => {
  const result = filterCustomers(customers, {
    query: "星河",
    status: "following",
    source: "referral",
    industry: "technology",
  });
  expect(result).toHaveLength(1);
});
```

```tsx
it("creates a session customer and updates the visible statistics", async () => {
  render(<CustomersPage />);
  const initialCount = screen.getByTestId("customer-total").textContent;
  await user.click(screen.getByRole("button", { name: "新建客户" }));
  await user.type(screen.getByLabelText("客户名称"), "新客户科技");
  await user.type(screen.getByLabelText("联系人"), "陈敏");
  await user.click(screen.getByRole("button", { name: "保存客户" }));
  expect(screen.getByText("新客户科技")).toBeInTheDocument();
  expect(screen.getByTestId("customer-total").textContent).not.toBe(initialCount);
});
```

Run:

```powershell
npm test -- src/features/customers/customer-selectors.test.ts src/features/customers/customers-page.test.tsx
```

Expected: FAIL.

### Step 3: Implement the typed Mock workflow

Implement combined search/filtering, visible statistics, detail dialog, required-field validation, page-session customer creation, funnel/reminder/activity cards, and source/industry/region distributions. Related project actions navigate to existing `/projects/[id]` routes.

### Step 4: Re-run focused verification

```powershell
npm test -- src/features/customers/customer-selectors.test.ts src/features/customers/customers-page.test.tsx
npm run typecheck
```

Expected: PASS.

---

## Task 8: Refine `/settings` from reference 15

**Files:**

- Modify: `src/features/settings/settings-workspace.tsx`
- Modify: `src/features/settings/settings-page.test.tsx`
- Modify: `src/features/settings/components/enterprise-settings.tsx`
- Modify: `src/features/settings/components/personal-settings.tsx`
- Modify or replace in feature scope: `src/features/settings/components/base-settings.tsx`
- Create: `src/features/settings/components/notification-settings.tsx`
- Create: `src/features/settings/settings-session.ts`
- Create: `src/features/settings/settings-session.test.ts`
- Stop rendering: `src/features/settings/components/permission-placeholder.tsx`

### Step 1: Load image-to-code instructions and inspect reference 15

Retain the outer glass panel, left vertical settings navigation, top save/cancel area, three-column setting cards, and bottom quick-config row. Only enterprise, personal, and notification settings are active entries.

### Step 2: Write failing session and UI tests

```ts
it("round-trips settings through session storage", () => {
  saveSettingsSession(state);
  expect(readSettingsSession()).toEqual(state);
});
```

```tsx
it("saves edits and cancel restores the entry snapshot", async () => {
  render(<SettingsPage />);
  const companyName = screen.getByLabelText("企业名称");
  await user.clear(companyName);
  await user.type(companyName, "量子星河集团");
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(companyName).toHaveValue("量子星河科技有限公司");

  await user.clear(companyName);
  await user.type(companyName, "量子星河集团");
  await user.click(screen.getByRole("button", { name: "保存设置" }));
  expect(screen.getByText("设置已保存")).toBeInTheDocument();
});
```

Also test that permission placeholders are absent and non-image file selection shows an error without creating a preview.

Run:

```powershell
npm test -- src/features/settings/settings-session.test.ts src/features/settings/settings-page.test.tsx
```

Expected: FAIL against the current settings implementation.

### Step 3: Implement the approved settings structure

- Enterprise: name, short name, logo preview, timezone, language, founding date, work week.
- Personal: avatar preview, name, email, password inputs.
- Notifications: in-app, email, daily digest, system preference toggles.
- Save writes a versioned object to `sessionStorage` and refreshes the cancel snapshot.
- Cancel restores the snapshot that existed when the current page session began.
- Image selection accepts `image/*`, revokes superseded object URLs, and reports invalid types.

### Step 4: Re-run focused verification

```powershell
npm test -- src/features/settings/settings-session.test.ts src/features/settings/settings-page.test.tsx
npm run typecheck
```

Expected: PASS.

---

## Task 9: Enable navigation and add route-level regression coverage

**Files:**

- Modify: `src/config/navigation.ts`
- Modify: `src/components/shell/workspace-shell.test.tsx`
- Create: `tests/e2e/v09-page-completion.spec.ts`

### Step 1: Write failing navigation assertions

```tsx
it.each([
  ["任务管理", "/tasks"],
  ["知识库", "/knowledge"],
  ["客户管理", "/customers"],
  ["数据分析", "/analytics"],
])("renders %s as an available link", (label, href) => {
  render(<WorkspaceShell>{children}</WorkspaceShell>);
  expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
});
```

Run:

```powershell
npm test -- src/components/shell/workspace-shell.test.tsx
```

Expected: FAIL while navigation entries remain unavailable.

### Step 2: Enable only the four missing navigation entries

Set `available: true` for tasks, analytics, knowledge, and customers. Preserve current labels, icons, ordering, routes, and all completed-module entries.

### Step 3: Add Playwright route and interaction coverage

The E2E test must visit each route, assert the approved title and one reference-specific section, exercise one key interaction, and check browser errors:

```ts
for (const route of routes) {
  await page.goto(route.path);
  await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
  await expect(page.getByText(route.landmark)).toBeVisible();
}
```

Include:

- task search + detail dialog;
- analytics range change;
- knowledge category + preview dialog;
- customer create validation + detail dialog;
- settings edit + cancel;
- 430 × 932 task page horizontal-overflow assertion.

### Step 4: Run route regression tests

```powershell
npm test -- src/components/shell/workspace-shell.test.tsx
npm run test:e2e -- tests/e2e/v09-page-completion.spec.ts
```

Expected: PASS.

---

## Task 10: Full verification, visual comparison, and screenshots

**Files:**

- Create: `artifacts/v09-page-completion/tasks-desktop.png`
- Create: `artifacts/v09-page-completion/analytics-desktop.png`
- Create: `artifacts/v09-page-completion/knowledge-desktop.png`
- Create: `artifacts/v09-page-completion/customers-desktop.png`
- Create: `artifacts/v09-page-completion/settings-desktop.png`
- Create: `artifacts/v09-page-completion/tasks-mobile.png`

### Step 1: Run automated quality gates

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Expected: all commands exit successfully. If an existing unrelated failure appears, record its exact file and error before deciding whether it is in scope.

### Step 2: Run browser QA with frontend testing/debugging instructions

At desktop width, compare each page side-by-side with its approved reference for:

- card position and relative size;
- visual hierarchy and whitespace;
- background gradients and translucency;
- icon-container shape and color restraint;
- typography scale;
- table/list density;
- dialog fit and scroll behavior.

At 430 × 932, verify the task page and spot-check all remaining routes for no page-level horizontal overflow and no clipped primary actions.

### Step 3: Capture the six required screenshots

Store only final-state captures in `artifacts/v09-page-completion/` with the exact filenames listed above.

### Step 4: Run verification-before-completion and prepare the final report

The final report must include:

- completed modules and interactions;
- route list;
- modified files;
- new files;
- test/build results with exact commands;
- clickable screenshot links;
- any consciously deferred items that remain outside V0.9 scope.

---

## Plan self-review checklist

- Every approved route has a route file, page component, feature workspace, test, and reference-image mapping.
- `/tasks` and `/analytics` share the effective project/task source and do not create duplicate domain models.
- Task status changes write back through the existing project repository and recalculate project progress.
- Knowledge and customer data remain feature-local Mock models.
- Settings exposes only enterprise, personal, and notification entries and preserves the existing workspace shell.
- All filters and aggregate selectors are pure and covered before UI implementation.
- All visible new controls have a specified observable behavior.
- Desktop and 430 × 932 acceptance paths are both included.
- Full Vitest, typecheck, lint, build, and Playwright verification are required before completion is claimed.
- No Feishu, Supabase, authentication, permission-page, or completed-module rewrite is included.
