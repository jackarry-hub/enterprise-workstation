# Project Create and Task Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a refresh-safe Mock workflow that creates projects, opens their detail pages, creates and assigns tasks, updates task status, and automatically recalculates project progress.

**Architecture:** Keep the existing `ProjectDetailData` aggregate as the single domain contract. Add a versioned browser repository that stores complete local overrides, merge those overrides into the existing list and detail entry points, and keep all project/task mutations as pure operations before one atomic repository write. No Supabase, authentication, permission, layout, or global state changes are introduced.

**Tech Stack:** Next.js 15.5.22 App Router, React 19, TypeScript, Tailwind CSS 4, existing shadcn/Radix components, Lucide React, Vitest, Testing Library, Playwright Chrome.

## Global Constraints

- Continue using Mock data; do not configure Supabase.
- Do not add login, authentication, or permission logic.
- Preserve Workspace Layout, Sidebar, Header, project list, project header, and existing Tab styling.
- Reuse `GlassCard`, `DataCard`, `StatusBadge`, `Dialog`, `Tabs`, `Button`, `Select`, `Avatar`, and existing form inputs.
- Only implement new project creation and the project detail task workflow.
- Desktop and mobile browser flows must remain usable without horizontal overflow.
- The workspace is not a Git repository, so each task ends with a verification checkpoint instead of a commit command.

---

### Task 1: Versioned Mock project repository and list merge

**Files:**
- Create: `src/features/projects/data/mock-project-repository.ts`
- Create: `src/features/projects/data/mock-project-repository.test.ts`
- Create: `src/features/projects/data/project-list-operations.ts`
- Create: `src/features/projects/data/project-list-operations.test.ts`
- Modify: `src/features/projects/types.ts`

**Interfaces:**
- Consumes: existing `ProjectDetailData`, `ProjectListItem`, `ProjectPortfolioStat`, `mockProjects`, `mockMembers`, and `getProjectListMock()`.
- Produces:

```ts
export type CreateMockProjectInput = {
  name: string;
  description: string;
  ownerId: string;
  memberIds: readonly string[];
  startDate: string;
  dueDate: string;
  priority: ProjectPriority;
  status: "planning" | "active";
};

export type MockProjectRepositoryOptions = {
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now?: () => Date;
  createId?: () => string;
};

export const PROJECTS_CHANGED_EVENT = "enterprise-workspace:projects-changed";
export function readLocalProjects(options?: MockProjectRepositoryOptions): ProjectDetailData[];
export function findLocalProject(projectId: string, options?: MockProjectRepositoryOptions): ProjectDetailData | undefined;
export function saveLocalProject(detail: ProjectDetailData, options?: MockProjectRepositoryOptions): void;
export function createLocalProject(input: CreateMockProjectInput, options?: MockProjectRepositoryOptions): ProjectDetailData;
export function clearLocalProjects(options?: MockProjectRepositoryOptions): void;

export function projectDetailToListItem(detail: ProjectDetailData): ProjectListItem;
export function mergeProjectList(base: readonly ProjectListItem[], local: readonly ProjectDetailData[]): ProjectListItem[];
export function mergePortfolioStats(baseStats: readonly ProjectPortfolioStat[], baseProjects: readonly ProjectListItem[], mergedProjects: readonly ProjectListItem[]): ProjectPortfolioStat[];
```

- [ ] **Step 1: Write repository failure-first tests**

Create an in-test memory storage and assert project construction, owner membership, refresh-safe reads, code sequencing, corrupt JSON recovery, and write failures:

```ts
it("creates and persists a complete project aggregate", () => {
  const storage = createMemoryStorage();
  const ids = ["project-local-1", "owner-membership-1", "member-membership-1"];
  const detail = createLocalProject({
    name: "客户门户二期",
    description: "完善客户自助服务与交付进度查询。",
    ownerId: mockMembers[0].id,
    memberIds: [mockMembers[0].id, mockMembers[3].id],
    startDate: "2026-08-10",
    dueDate: "2026-10-30",
    priority: "high",
    status: "planning",
  }, {
    storage,
    now: () => new Date("2026-08-05T02:00:00.000Z"),
    createId: () => ids.shift() ?? "extra-id",
  });

  expect(detail.project).toMatchObject({
    id: "project-local-1",
    code: "PRJ-2026-025",
    progress: 0,
    health: "on_track",
  });
  expect(detail.members.map(({ role }) => role)).toEqual(["owner", "member"]);
  expect(readLocalProjects({ storage })).toEqual([detail]);
});

it("treats corrupt browser storage as an empty local portfolio", () => {
  const storage = createMemoryStorage("{broken-json");
  expect(readLocalProjects({ storage })).toEqual([]);
});
```

- [ ] **Step 2: Run repository tests and verify RED**

Run: `npx vitest run src/features/projects/data/mock-project-repository.test.ts`

Expected: FAIL because the repository exports do not exist.

- [ ] **Step 3: Implement the repository contract**

Use the exact storage envelope and validation boundary:

```ts
const STORAGE_KEY = "enterprise-workspace.projects.v1";

type LocalProjectStore = {
  version: 1;
  projects: Array<{ detail: ProjectDetailData; savedAt: string }>;
};

function resolveStorage(options?: MockProjectRepositoryOptions) {
  return options?.storage
    ?? (typeof window === "undefined" ? undefined : window.localStorage);
}

function notifyProjectChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
  }
}
```

Validate required input before creating anything, generate `PRJ-YYYY-NNN` from both default and local projects, deduplicate the owner from `memberIds`, create empty arrays for milestones/tasks/comments/files/reports/activities/risks/relations, replace records by project ID in `saveLocalProject`, and only notify after `setItem` succeeds.

- [ ] **Step 4: Run repository tests and verify GREEN**

Run: `npx vitest run src/features/projects/data/mock-project-repository.test.ts`

Expected: all repository tests pass.

- [ ] **Step 5: Write list merge failure-first tests**

```ts
it("adds new projects and lets local records override matching defaults", () => {
  const localOverride = structuredClone(getProjectDetailMock(mockProjects[0].id)!);
  localOverride.project.progress = 75;
  const localCreated = createProjectFixture({ id: "project-local-1", status: "active" });

  const merged = mergeProjectList(
    getProjectListMock(),
    [localOverride, localCreated],
  );

  expect(merged.find(({ id }) => id === mockProjects[0].id)?.progress).toBe(75);
  expect(merged.some(({ id }) => id === "project-local-1")).toBe(true);
});

it("applies local deltas without replacing the portfolio baseline", () => {
  const baseProjects = getProjectListMock();
  const merged = [...baseProjects, projectDetailToListItem(createProjectFixture({ status: "active" }))];
  const stats = mergePortfolioStats(mockProjectPortfolioStats, baseProjects, merged);
  expect(stats.map(({ value }) => value)).toEqual([25, 17, 6, 2]);
});
```

- [ ] **Step 6: Run list operation tests and verify RED**

Run: `npx vitest run src/features/projects/data/project-list-operations.test.ts`

Expected: FAIL because list merge operations do not exist.

- [ ] **Step 7: Implement list conversion, override merge, stable sorting, and stat deltas**

`projectDetailToListItem` must take the owner from `detail.owner`, map active memberships to `members`, set the current demo member role from the matching membership, and preserve existing status/due-date sorting. `mergePortfolioStats` must calculate the category-count difference between the visible base list and merged list, then add that difference to the existing portfolio baseline instead of replacing `24/16/6/2` with the four visible fixture rows.

- [ ] **Step 8: Verify Task 1 checkpoint**

Run:

```powershell
npx vitest run src/features/projects/data/mock-project-repository.test.ts src/features/projects/data/project-list-operations.test.ts
npm run typecheck
```

Expected: repository and list tests pass; TypeScript exits with code 0.

---

### Task 2: New project Dialog and live project list

**Files:**
- Create: `src/features/projects/components/create-project-dialog.tsx`
- Modify: `src/features/projects/projects-workspace.tsx`
- Modify: `src/features/projects/projects-page.test.tsx`

**Interfaces:**
- Consumes: `createLocalProject`, `readLocalProjects`, `mergeProjectList`, `mergePortfolioStats`, existing `mockMembers`, `Dialog`, `Input`, `Select`, `ToggleGroup`, and `Button`.
- Produces:

```ts
type CreateProjectDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (detail: ProjectDetailData) => void;
};
```

- [ ] **Step 1: Add failing page interaction tests**

Extend `ProjectsPage` tests with real user interactions and a controlled `localStorage`:

```tsx
it("creates a refresh-safe mock project from the header action", async () => {
  const user = userEvent.setup();
  render(<ProjectsPage />);

  await user.click(screen.getByRole("button", { name: "新建项目" }));
  const dialog = screen.getByRole("dialog", { name: "新建项目" });
  await user.type(within(dialog).getByLabelText("项目名称"), "客户门户二期");
  await user.type(within(dialog).getByLabelText("项目描述"), "完善客户自助服务能力");
  await user.clear(within(dialog).getByLabelText("开始日期"));
  await user.type(within(dialog).getByLabelText("开始日期"), "2026-08-10");
  await user.type(within(dialog).getByLabelText("截止日期"), "2026-10-30");
  await user.click(within(dialog).getByRole("button", { name: "创建项目" }));

  expect(await screen.findByText("客户门户二期")).toBeVisible();
  expect(screen.queryByRole("dialog", { name: "新建项目" })).not.toBeInTheDocument();
});

it("keeps the dialog open when the project date range is invalid", async () => {
  // Fill 2026-10-30 as start and 2026-08-10 as due.
  expect(await screen.findByRole("alert")).toHaveTextContent("截止日期不能早于开始日期");
  expect(screen.getByRole("dialog", { name: "新建项目" })).toBeVisible();
});
```

- [ ] **Step 2: Run page tests and verify RED**

Run: `npx vitest run src/features/projects/projects-page.test.tsx`

Expected: FAIL because the “新建项目” button does not open a dialog.

- [ ] **Step 3: Implement `CreateProjectDialog`**

Use controlled owner/member/status/priority state, preserve trigger focus, and keep repository access outside the component by returning validated input through `createLocalProject` in the parent callback. The component layout is:

```tsx
<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
  <DialogContent className="max-w-2xl">
    <DialogHeader>
      <DialogTitle>新建项目</DialogTitle>
      <DialogDescription>建立项目目标、负责人和交付周期</DialogDescription>
    </DialogHeader>
    <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
      {/* name, description, owner, member ToggleGroup, dates, priority, status */}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeDialog}>取消</Button>
        <Button type="submit">创建项目</Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
```

Every `SelectItem` must be inside `SelectGroup`; every `Avatar` must include `AvatarFallback`; project name receives `autoFocus`. Display field-level errors with `aria-invalid` and a form-level `role="alert"` summary.

- [ ] **Step 4: Make `ProjectsWorkspace` merge browser records and own creation state**

Add `baseProjects`, `visibleProjects`, `isCreateOpen`, and a stable refresh function:

```tsx
const [visibleProjects, setVisibleProjects] = useState<ProjectListItem[]>([...projects]);
const router = useRouter();

const refreshLocalProjects = useCallback(() => {
  setVisibleProjects(mergeProjectList(projects, readLocalProjects()));
}, [projects]);

useEffect(() => {
  refreshLocalProjects();
  window.addEventListener(PROJECTS_CHANGED_EVENT, refreshLocalProjects);
  return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, refreshLocalProjects);
}, [refreshLocalProjects]);
```

On creation, call `createLocalProject`, refresh the merged list, close the dialog, and navigate with `router.push(`/projects/${detail.project.id}`)`. Derive owners, filters, and stats from `visibleProjects`; keep reminders unchanged.

- [ ] **Step 5: Run page tests and verify GREEN**

Run: `npx vitest run src/features/projects/projects-page.test.tsx`

Expected: original project list tests plus create/validation/focus tests pass.

- [ ] **Step 6: Verify Task 2 checkpoint**

Run:

```powershell
npx vitest run src/features/projects/projects-page.test.tsx src/features/projects/data/mock-project-repository.test.ts src/features/projects/data/project-list-operations.test.ts
npm run typecheck
npm run lint
```

Expected: all targeted tests pass; TypeScript and ESLint exit with code 0.

---

### Task 3: Cross-route local project detail resolution

**Files:**
- Modify: `src/app/(workspace)/projects/[id]/page.tsx`
- Modify: `src/features/projects/project-detail-page.tsx`
- Modify: `src/features/projects/project-detail-page.test.tsx`

**Interfaces:**
- Consumes: optional server `ProjectDetailResult`, `findLocalProject(projectId)`, existing `ProjectDetailWorkspace`, `GlassCard`, and `Button`.
- Produces:

```ts
type ProjectDetailPageProps = {
  projectId: string;
  initialResult?: ProjectDetailResult;
};
```

- [ ] **Step 1: Add failing local detail resolution tests**

```tsx
it("renders a browser-created project when the server has no matching result", async () => {
  saveLocalProject(createProjectDetailFixture({ id: "project-local-1", name: "客户门户二期" }));
  render(<ProjectDetailPage projectId="project-local-1" />);
  expect(await screen.findByRole("heading", { name: "客户门户二期" })).toBeVisible();
});

it("shows a friendly missing state for an unknown project id", async () => {
  render(<ProjectDetailPage projectId="missing-project" />);
  expect(await screen.findByRole("heading", { name: "未找到项目" })).toBeVisible();
});
```

- [ ] **Step 2: Run detail page tests and verify RED**

Run: `npx vitest run src/features/projects/project-detail-page.test.tsx`

Expected: FAIL because `ProjectDetailPage` currently requires a server result and the route calls `notFound()`.

- [ ] **Step 3: Implement the client detail resolver**

Mark `ProjectDetailPage` as a client component. Start with `initialResult`, then in `useEffect` prefer a matching `findLocalProject(projectId)`. Render a compact `GlassCard` loading state until local resolution completes. Render `ProjectDetailWorkspace` with `{ detail: local, source: "mock" }` when found; otherwise render an existing-style not-found card with a link back to `/projects`.

- [ ] **Step 4: Change the route to pass optional server data**

Replace `notFound()` with:

```tsx
const initialResult = await loadProjectDetail(id);
return <ProjectDetailPage projectId={id} initialResult={initialResult} />;
```

Keep the route metadata and async `params` contract unchanged.

- [ ] **Step 5: Run detail page tests and verify GREEN**

Run: `npx vitest run src/features/projects/project-detail-page.test.tsx`

Expected: existing overview/milestone tests and new local/unknown detail tests pass.

- [ ] **Step 6: Verify Task 3 checkpoint**

Run:

```powershell
npx vitest run src/features/projects/project-detail-page.test.tsx src/features/projects/projects-page.test.tsx
npm run typecheck
```

Expected: all targeted tests pass and TypeScript exits with code 0.

---

### Task 4: Pure task creation, status transition, and progress operations

**Files:**
- Create: `src/features/projects/data/project-task-operations.ts`
- Create: `src/features/projects/data/project-task-operations.test.ts`

**Interfaces:**
- Consumes: `ProjectDetailData`, `ProjectTask`, `TaskPriority`, and existing member IDs.
- Produces:

```ts
export type TaskExecutionStatus = "todo" | "in_progress" | "done";

export type CreateMockTaskInput = {
  title: string;
  description: string;
  assigneeId: string;
  dueDate: string;
  priority: TaskPriority;
};

export type TaskOperationOptions = {
  now?: () => Date;
  createId?: () => string;
};

export function calculateProjectProgress(tasks: readonly ProjectTask[]): number;
export function createMockTask(detail: ProjectDetailData, input: CreateMockTaskInput, options?: TaskOperationOptions): ProjectDetailData;
export function updateMockTaskStatus(detail: ProjectDetailData, taskId: string, status: TaskExecutionStatus, options?: TaskOperationOptions): ProjectDetailData;
```

- [ ] **Step 1: Write failing task operation tests**

```ts
it.each([
  [[], 0],
  [[task("done"), task("todo")], 50],
  [[task("done"), task("cancelled")], 100],
])("calculates progress from non-cancelled tasks", (tasks, expected) => {
  expect(calculateProjectProgress(tasks)).toBe(expected);
});

it("creates an assigned todo task and recalculates project progress", () => {
  const next = createMockTask(detailFixture, {
    title: "完成客户门户原型",
    description: "覆盖登录后首页与项目进度页",
    assigneeId: detailFixture.members[1].member.id,
    dueDate: "2026-08-28",
    priority: "high",
  }, {
    now: () => new Date("2026-08-05T03:00:00.000Z"),
    createId: () => "task-local-1",
  });

  expect(next.tasks.at(-1)).toMatchObject({
    id: "task-local-1",
    status: "todo",
    progress: 0,
  });
  expect(next.project.progress).toBe(calculateProjectProgress(next.tasks));
});

it("marks a task done and sets completion metadata", () => {
  const next = updateMockTaskStatus(detailFixture, detailFixture.tasks[0].id, "done", {
    now: () => new Date("2026-08-05T04:00:00.000Z"),
  });
  expect(next.tasks[0]).toMatchObject({ status: "done", progress: 100 });
  expect(next.tasks[0].completedAt).toBe("2026-08-05T04:00:00.000Z");
});
```

- [ ] **Step 2: Run task operation tests and verify RED**

Run: `npx vitest run src/features/projects/data/project-task-operations.test.ts`

Expected: FAIL because task operation exports do not exist.

- [ ] **Step 3: Implement validation and immutable aggregate updates**

`createMockTask` must trim strings, reject empty title/assignee, ensure the assignee belongs to `detail.members`, reject a due date earlier than `detail.project.startDate`, append with the next `sortOrder`, then recalculate project progress. `updateMockTaskStatus` must normalize progress to `0/50/100`, set or clear `completedAt`, update both task and project timestamps, and return the original aggregate when the task ID is absent.

- [ ] **Step 4: Run task operation tests and verify GREEN**

Run: `npx vitest run src/features/projects/data/project-task-operations.test.ts`

Expected: all task operation tests pass.

- [ ] **Step 5: Verify Task 4 checkpoint**

Run:

```powershell
npx vitest run src/features/projects/data/project-task-operations.test.ts src/features/projects/data/mock-project-repository.test.ts
npm run typecheck
```

Expected: tests pass and TypeScript exits with code 0.

---

### Task 5: Task Tab, create task Dialog, status update, and persisted progress

**Files:**
- Create: `src/features/projects/components/project-tasks-tab.tsx`
- Create: `src/features/projects/components/create-task-dialog.tsx`
- Modify: `src/features/projects/project-detail-workspace.tsx`
- Modify: `src/features/projects/project-detail-page.test.tsx`

**Interfaces:**
- Consumes: Task 4 operations, `saveLocalProject`, existing `ProjectDetailHeader`, `ProjectDetailTabs`, `GlassCard`, `StatusBadge`, `Dialog`, `Select`, `Avatar`, and `Button`.
- Produces:

```ts
type ProjectTasksTabProps = {
  detail: ProjectDetailData;
  onCreate: () => void;
  onStatusChange: (taskId: string, status: TaskExecutionStatus) => void;
};

type CreateTaskDialogProps = {
  detail: ProjectDetailData;
  open: boolean;
  onClose: () => void;
  onCreated: (input: CreateMockTaskInput) => void;
};
```

- [ ] **Step 1: Add failing task Tab interaction tests**

```tsx
it("renders task rows instead of the task placeholder", async () => {
  const user = userEvent.setup();
  render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);
  await user.click(screen.getByRole("tab", { name: "任务" }));
  expect(screen.getByRole("heading", { name: "项目任务" })).toBeVisible();
  expect(screen.getByText(detail.tasks[0].title)).toBeVisible();
  expect(screen.queryByText("任务模块将在后续阶段开放")).not.toBeInTheDocument();
});

it("opens task creation from the project header and updates progress", async () => {
  const user = userEvent.setup();
  render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);
  await user.click(screen.getByRole("button", { name: "添加任务" }));
  const dialog = screen.getByRole("dialog", { name: "新建任务" });
  await user.type(within(dialog).getByLabelText("任务名称"), "完成客户门户原型");
  await user.click(within(dialog).getByRole("button", { name: "创建任务" }));
  expect(await screen.findByText("完成客户门户原型")).toBeVisible();
});

it("marks a task complete and recalculates the visible project progress", async () => {
  const user = userEvent.setup();
  // Open the status Select for the first task and choose “已完成”.
  expect(await screen.findByText(/项目进度/)).toBeVisible();
  expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run detail page tests and verify RED**

Run: `npx vitest run src/features/projects/project-detail-page.test.tsx`

Expected: FAIL because the Task Tab still renders the deferred-state card.

- [ ] **Step 3: Implement `ProjectTasksTab`**

Build four summary blocks inside a top `GlassCard` and an accessible task list inside a second `GlassCard`. Normalize `backlog` to `todo` and `in_review` to `in_progress` for the status control. Keep `cancelled` rows read-only. Use existing semantic tones:

```ts
const priorityTone = {
  low: "neutral",
  medium: "active",
  high: "warning",
  urgent: "danger",
} as const;
```

The status `Select` must use `SelectGroup` and three `SelectItem` values: `todo`, `in_progress`, `done`. Mobile rows use `grid gap-3`; desktop rows use the existing lightweight column rhythm rather than a dense table.

- [ ] **Step 4: Implement `CreateTaskDialog`**

Use the same focus restoration and form error pattern as `CreateMilestoneDialog`. Default assignee to the owner membership, default due date to `detail.project.dueDate`, and submit a trimmed `CreateMockTaskInput`. The dialog does not write storage.

- [ ] **Step 5: Refactor `ProjectDetailWorkspace` to own one current aggregate**

Replace independent milestone-only state with:

```tsx
const [detail, setDetail] = useState(result.detail);
const [activeTab, setActiveTab] = useState<ProjectDetailTab>("overview");
const [isTaskOpen, setIsTaskOpen] = useState(false);

function persistDetail(next: ProjectDetailData) {
  saveLocalProject(next);
  setDetail(next);
}
```

Pass `detail` to Header, Overview, Milestones, and Tasks. The header `onAddTask` sets `tasks` and opens the task dialog. Task creation calls `createMockTask`, status change calls `updateMockTaskStatus`, and both persist exactly once. Existing local milestone creation must also update and save the same aggregate.

- [ ] **Step 6: Run detail page tests and verify GREEN**

Run: `npx vitest run src/features/projects/project-detail-page.test.tsx`

Expected: overview, milestone, focus, task create, task status, and progress tests pass.

- [ ] **Step 7: Verify Task 5 checkpoint**

Run:

```powershell
npx vitest run src/features/projects/project-detail-page.test.tsx src/features/projects/data/project-task-operations.test.ts src/features/projects/data/mock-project-repository.test.ts
npm run typecheck
npm run lint
```

Expected: all targeted tests pass; TypeScript and ESLint exit with code 0.

---

### Task 6: Browser business-flow verification, screenshots, and handoff report

**Files:**
- Create: `tests/e2e/projects-closure.spec.ts`
- Modify: `src/features/projects/README.md`
- Modify: `design-qa.md`
- Create: `artifacts/projects-v1/project-closure-desktop-1672x941.png`
- Create: `artifacts/projects-v1/project-tasks-mobile-430x932.png`

**Interfaces:**
- Consumes: completed `/projects` and `/projects/[id]` Mock workflows.
- Produces: repeatable desktop/mobile evidence and final implementation report.

- [ ] **Step 1: Write the end-to-end business-flow test before final browser fixes**

```ts
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("enterprise-workspace.projects.v1");
  });
});

test("creates a project, assigns a task, completes it, and survives refresh", async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/projects", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill("客户门户二期");
  await page.getByLabel("项目描述").fill("完善客户自助服务与交付进度查询");
  await page.getByLabel("开始日期").fill("2026-08-10");
  await page.getByLabel("截止日期").fill("2026-10-30");
  await page.getByRole("button", { name: "创建项目" }).click();

  await expect(page.getByRole("heading", { name: "客户门户二期" })).toBeVisible();
  await page.getByRole("button", { name: "添加任务" }).click();
  await page.getByLabel("任务名称").fill("完成客户门户原型");
  await page.getByRole("button", { name: "创建任务" }).click();
  await expect(page.getByText("完成客户门户原型")).toBeVisible();

  await page.getByLabel("完成客户门户原型状态").click();
  await page.getByRole("option", { name: "已完成" }).click();
  await expect(page.getByText("100%", { exact: true }).first()).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("完成客户门户原型")).toBeVisible();
});
```

- [ ] **Step 2: Run the end-to-end test and verify the complete flow**

Run: `npx playwright test tests/e2e/projects-closure.spec.ts`

Expected: the desktop flow passes without console errors.

- [ ] **Step 3: Add mobile overflow and screenshot coverage**

Add a 430 × 932 test that opens the task Tab and task Dialog, asserts `document.documentElement.scrollWidth <= window.innerWidth`, then saves `project-tasks-mobile-430x932.png`. Save the desktop screenshot after the task reaches `100%` as `project-closure-desktop-1672x941.png`.

- [ ] **Step 4: Run full verification**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/projects-closure.spec.ts
```

Expected: all Vitest files pass, TypeScript and ESLint exit with code 0, Next.js production build succeeds, and all project-closure Playwright tests pass.

- [ ] **Step 5: Restart the verified production preview and capture evidence**

Resolve the exact process listening on port 3000, confirm its command line belongs to `E:\企业的工作站`, stop that PID, and start `npm run start` hidden from the same workspace. Verify both `/projects` and the created local detail route return a usable browser page in the same browser profile.

- [ ] **Step 6: Update module and Design QA documentation**

Document the local storage key, project/task operation boundaries, refresh behavior, test counts, desktop/mobile viewport results, screenshot paths, and `Browser plugin not available; Playwright Chrome used for requested screenshot verification.` Ensure the last line of `design-qa.md` remains exactly:

```text
final result: passed
```

- [ ] **Step 7: Produce the requested function report**

Report separately:

1. New project flow: completed behavior, modified/new files, test result, screenshot.
2. Project task module: task list, create task, status updates, progress calculation, modified/new files, test result, screenshot.
3. Explicitly state that Supabase, authentication, permissions, and other modules were not changed.

---

## Self-Review Result

- Spec coverage: project creation, refresh persistence, cross-route detail, task list, task creation, assignment, three-state updates, progress calculation, desktop/mobile validation, and screenshots are each assigned to a task.
- Boundary check: all persistence stays inside `features/projects`; no global store, Supabase, auth, permission, or unrelated module change is planned.
- Type consistency: `CreateMockProjectInput`, `CreateMockTaskInput`, `TaskExecutionStatus`, repository functions, and component props use the same names across producers and consumers.
- Execution order: repository and pure operations precede UI consumers; browser coverage runs only after component tests pass.
