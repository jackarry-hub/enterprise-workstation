# Task Execution Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Mock-backed task detail, comment, status feedback, and project activity loop inside the existing project detail task Tab.

**Architecture:** Keep `ProjectDetailData` as the single client-side aggregate and persist each command through the existing versioned Mock repository. Add a small Mock Auth adapter that supplies the current actor, pass that actor into pure task operation functions, and render task details in a reusable controlled Dialog selected by task ID.

**Tech Stack:** Next.js 15.5.22, React 19.2.4, TypeScript 5, Tailwind CSS 4, shadcn/Radix Dialog, Vitest, Testing Library, Playwright.

## Global Constraints

- Do not change Workspace Layout, Sidebar, Header, existing project visual language, or other business modules.
- Continue Mock/localStorage data only; do not configure Supabase, Auth, RLS, or permissions.
- Do not hard-code “李总” in task business code; all new operation identity comes from `currentUser`.
- Reuse `GlassCard`, `Dialog`, `Tabs`, `Avatar`, `StatusBadge`, `Select`, and existing project types.
- Keep `tasks`, `task_comments`, and `project_activities` as the stable models; do not add migrations or duplicate tables.
- Support desktop and 430px mobile viewports without horizontal overflow.
- The installed Next package does not contain `node_modules/next/dist/docs`; no local framework guide is available beyond the package API/types already used by the project.
- The workspace `.git` directory is not an initialized repository, so commit steps are intentionally omitted and the final report must list every changed file.

---

### Task 1: Add the current-user adapter and actor-aware task events

**Files:**
- Create: `src/lib/auth/mock-user.ts`
- Modify: `src/features/projects/data/project-task-operations.ts`
- Test: `src/features/projects/data/project-task-operations.test.ts`

**Interfaces:**
- Produces: `CurrentUser`, `CurrentUserRole`, and `currentUser` from `@/lib/auth/mock-user`.
- Produces: `TaskOperationActor` and an optional `actor` field on `TaskOperationOptions`.
- Changes: `createMockTask` uses the actor for `reporterId` and prepends a `task_updated` creation activity.
- Changes: `updateMockTaskStatus` prepends a `task_updated` status activity only when the effective state changes.

- [ ] **Step 1: Write failing actor and activity tests**

Add literal assertions to the existing operation tests:

```ts
const actor = { id: "viewer-1", name: "演示用户" };

expect(next.tasks.at(-1)).toMatchObject({ reporterId: "viewer-1" });
expect(next.activities[0]).toMatchObject({
  userId: "viewer-1",
  actionType: "task_updated",
  content: "演示用户创建了任务「完成客户门户原型」",
});

expect(statusChanged.activities[0]).toMatchObject({
  userId: "viewer-1",
  content: "演示用户将任务「搭建官网前端工程与组件基线」更新为「已完成」",
});
expect(updateMockTaskStatus(statusChanged, taskId, "done", { actor })).toBe(statusChanged);
```

Inject deterministic IDs and time with `createId` and `now`; use a queue because creating a task now creates both a task ID and activity ID.

- [ ] **Step 2: Run the operation tests and verify RED**

Run: `npm test -- src/features/projects/data/project-task-operations.test.ts`

Expected: FAIL because tasks still use the project owner as reporter and no task activities are created.

- [ ] **Step 3: Add the Mock User Context**

Create the adapter with no business imports:

```ts
export type CurrentUserRole = "owner" | "admin" | "department_lead" | "employee" | "hr" | "finance";

export type CurrentUser = Readonly<{
  id: string;
  name: string;
  role: CurrentUserRole;
  avatarUrl?: string;
}>;

export const currentUser: CurrentUser = Object.freeze({
  id: "21000000-0000-4000-8000-000000000001",
  name: "李总",
  role: "owner",
});
```

This file is the only new source that contains the demo identity literal.

- [ ] **Step 4: Implement actor-aware task activities**

Add the domain-facing actor shape and helper:

```ts
export type TaskOperationActor = { id: string; name: string };

export type TaskOperationOptions = {
  actor?: TaskOperationActor;
  now?: () => Date;
  createId?: () => string;
};

function resolveActor(detail: ProjectDetailData, options?: TaskOperationOptions) {
  return options?.actor ?? { id: detail.owner.id, name: detail.owner.displayName };
}
```

Use it to set `reporterId`, and prepend activities shaped as:

```ts
{
  id: createIdentifier(options),
  organizationId: detail.project.organizationId,
  projectId: detail.project.id,
  userId: actor.id,
  actionType: "task_updated",
  content,
  createdAt: timestamp,
}
```

Return the original aggregate before creating a timestamp when the requested normalized status already matches the task status.

- [ ] **Step 5: Run focused and regression tests**

Run:

```powershell
npm test -- src/features/projects/data/project-task-operations.test.ts
npm test
```

Expected: all operation tests and the existing suite PASS.

---

### Task 2: Add the pure comment command and paired project activity

**Files:**
- Modify: `src/features/projects/data/project-task-operations.ts`
- Test: `src/features/projects/data/project-task-operations.test.ts`

**Interfaces:**
- Produces: `addMockTaskComment(detail, taskId, body, options): ProjectDetailData`.
- Consumes: `TaskOperationOptions.actor`, `TaskComment`, and the existing aggregate arrays.
- Guarantees: one valid comment and one activity are written atomically; blank comments throw; missing tasks return the original aggregate.

- [ ] **Step 1: Write failing comment tests**

Add independent behavior tests:

```ts
const next = addMockTaskComment(detail, detail.tasks[0].id, "  已完成首轮联调，请协助验收。  ", {
  actor,
  now: () => new Date("2026-08-05T06:00:00.000Z"),
  createId: (() => {
    const ids = ["comment-local-1", "activity-local-1"];
    return () => ids.shift()!;
  })(),
});

expect(next.comments.at(-1)).toMatchObject({
  id: "comment-local-1",
  taskId: detail.tasks[0].id,
  authorId: "viewer-1",
  body: "已完成首轮联调，请协助验收。",
});
expect(next.activities[0]).toMatchObject({
  id: "activity-local-1",
  userId: "viewer-1",
  actionType: "task_updated",
  content: "演示用户评论了任务「搭建官网前端工程与组件基线」：已完成首轮联调，请协助验收。",
});
expect(next.project.progress).toBe(detail.project.progress);
```

Add separate cases for whitespace-only content, missing task ID, and a comment longer than 48 characters producing a 48-character summary plus `…`.

- [ ] **Step 2: Run the operation tests and verify RED**

Run: `npm test -- src/features/projects/data/project-task-operations.test.ts`

Expected: FAIL because `addMockTaskComment` does not exist.

- [ ] **Step 3: Implement the minimal comment command**

Implement the exact public signature:

```ts
export function addMockTaskComment(
  detail: ProjectDetailData,
  taskId: string,
  body: string,
  options?: TaskOperationOptions,
): ProjectDetailData
```

Trim the body, throw `new Error("请输入评论内容")` for an empty result, return `detail` for an unknown task, append the full `TaskComment`, prepend the summary `ProjectActivity`, and update `project.updatedAt` without changing `project.progress`.

- [ ] **Step 4: Run focused and regression tests**

Run:

```powershell
npm test -- src/features/projects/data/project-task-operations.test.ts
npm test
```

Expected: all tests PASS with no warning output.

---

### Task 3: Build the controlled task detail Dialog

**Files:**
- Create: `src/features/projects/components/task-detail-dialog.tsx`
- Modify: `src/features/projects/project-detail-page.test.tsx`

**Interfaces:**
- Consumes props:

```ts
type TaskDetailDialogProps = {
  detail: ProjectDetailData;
  taskId: string;
  actor: CurrentUser;
  operationError?: string;
  onClose: () => void;
  onStatusChange: (taskId: string, status: TaskExecutionStatus) => void;
  onCommentAdd: (taskId: string, body: string) => boolean;
};
```

- Produces: a controlled `Dialog` titled with the selected task and a comment form labeled `添加任务评论`.

- [ ] **Step 1: Write failing task-detail interaction tests**

Extend the page test with user-visible assertions:

```ts
await user.click(screen.getByRole("tab", { name: "任务" }));
await user.click(screen.getByRole("button", { name: "查看任务：搭建官网前端工程与组件基线" }));

const dialog = screen.getByRole("dialog", { name: "搭建官网前端工程与组件基线" });
expect(within(dialog).getByText("陈晨")).toBeVisible();
expect(within(dialog).getByText("2026/08/20")).toBeVisible();
expect(within(dialog).getByText("高")).toBeVisible();
expect(within(dialog).getByText("完成 Next.js 工程基线、公共组件和首页响应式结构。")).toBeVisible();
```

Add a separate test that submits `已完成首轮联调，请协助验收。`, then asserts the comment, `currentUser.name`, and a formatted timestamp are visible in the Dialog.

- [ ] **Step 2: Run the page test and verify RED**

Run: `npm test -- src/features/projects/project-detail-page.test.tsx`

Expected: FAIL because no task detail trigger or Dialog exists.

- [ ] **Step 3: Implement TaskDetailDialog**

Build a focused client component that:

- Finds the current task by `taskId` on each render so status changes are immediately reflected.
- Resolves comment authors from `actor.id` first, then `detail.members`, then displays `未知成员`.
- Sorts only the selected task’s comments by `createdAt` using a copied array.
- Uses existing `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `Avatar`, `StatusBadge`, `Select`, `Textarea`, and `Button`.
- Keeps local state only for the draft comment and validation message.
- Calls `onCommentAdd`; clears the input only when it returns `true`.
- Uses `max-h-[90vh] overflow-y-auto` and `sm:max-w-2xl` on the Dialog content.

- [ ] **Step 4: Run the page test and verify GREEN**

Run: `npm test -- src/features/projects/project-detail-page.test.tsx`

Expected: the new detail and comment tests PASS; existing project-detail tests remain green.

---

### Task 4: Integrate the Dialog, current user, and aggregate persistence

**Files:**
- Modify: `src/features/projects/components/project-tasks-tab.tsx`
- Modify: `src/features/projects/project-detail-workspace.tsx`
- Modify: `src/features/projects/project-detail-page.test.tsx`

**Interfaces:**
- Adds `onOpenTask(taskId: string): void` to `ProjectTasksTab`.
- Consumes `currentUser` only in `ProjectDetailWorkspace`, then passes it to operation functions and the Dialog.
- Adds `selectedTaskId: string | null` and `taskOperationError: string | undefined` workspace state.

- [ ] **Step 1: Write failing integration tests**

Add tests that:

1. Change a task state in the Dialog and assert the header progress changes.
2. Add a comment, close the Dialog, switch to 概览, and assert the newest project dynamic contains `currentUser.name` and the task title.
3. Assert `localStorage` contains the new comment and activity.
4. Click the list status combobox and assert the task detail Dialog does not open.

- [ ] **Step 2: Run the page test and verify RED**

Run: `npm test -- src/features/projects/project-detail-page.test.tsx`

Expected: FAIL because the page does not wire task selection, actor-aware operations, comments, or activity rendering together.

- [ ] **Step 3: Add the accessible task trigger**

In each task row, make the title/description area a real button with:

```tsx
<button
  type="button"
  aria-label={`查看任务：${task.title}`}
  onClick={() => onOpenTask(task.id)}
  className="min-w-0 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
>
  {/* existing title and description */}
</button>
```

Keep the status `Select` outside the button so native semantics and event behavior stay valid.

- [ ] **Step 4: Wire workspace commands through currentUser**

Import `currentUser` in `ProjectDetailWorkspace` and call:

```ts
createMockTask(detail, input, { actor: currentUser })
updateMockTaskStatus(detail, taskId, status, { actor: currentUser })
addMockTaskComment(detail, taskId, body, { actor: currentUser })
```

Persist each returned aggregate once. Catch repository write errors, keep the previous `detail`, and expose `保存失败，请稍后重试。` to the tasks area and Dialog. Clear that error after a successful operation.

Render `TaskDetailDialog` only while `selectedTaskId` is non-null; closing clears the ID so draft state unmounts and resets without an effect.

- [ ] **Step 5: Run focused tests, typecheck, and lint**

Run:

```powershell
npm test -- src/features/projects/project-detail-page.test.tsx src/features/projects/data/project-task-operations.test.ts
npm run typecheck
npm run lint
```

Expected: all commands exit 0 with no new warnings.

---

### Task 5: Complete browser verification and screenshots

**Files:**
- Modify: `tests/e2e/projects-closure.spec.ts`
- Create: `artifacts/projects-v1/task-feedback-desktop-1672x941.png`
- Create: `artifacts/projects-v1/task-feedback-activity-desktop-1672x941.png`
- Create: `artifacts/projects-v1/task-feedback-mobile-430x932.png`

**Interfaces:**
- Extends the existing project closure browser journey; no production API changes.

- [ ] **Step 1: Write the failing Playwright flow**

Extend the existing desktop scenario after task creation:

```ts
await page.getByRole("button", { name: "查看任务：完成客户门户原型" }).click();
await page.getByLabel("添加任务评论").fill("已完成首轮联调，请协助验收。");
await page.getByRole("button", { name: "发布评论" }).click();
await expect(page.getByText("已完成首轮联调，请协助验收。")).toBeVisible();
```

Update status inside the Dialog, capture the task-detail screenshot, close it, switch to 概览, assert the new activity, capture the activity screenshot, reload, and confirm the comment persists. Extend the mobile scenario to open an existing task, verify no horizontal overflow, add a comment, and capture the mobile Dialog.

- [ ] **Step 2: Run the focused E2E test and verify RED**

Run: `npx playwright test tests/e2e/projects-closure.spec.ts`

Expected: FAIL on the missing task-detail trigger or comment field before integration is complete.

- [ ] **Step 3: Re-run browser verification after implementation**

Run: `npx playwright test tests/e2e/projects-closure.spec.ts`

Expected: both desktop and mobile feedback-loop scenarios PASS, screenshots exist, and captured console error arrays remain empty.

- [ ] **Step 4: Run the full release verification**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Expected: every command exits 0. Inspect the three PNG files for clipped content, unreadable text, wrong overlay positioning, mobile overflow, and visual drift from existing glass cards.

- [ ] **Step 5: Produce the completion report**

Report completed behavior, all modified and created files, database changes (`none`), Mock User Context boundary, test command results, access URL, and embed the verified screenshots using absolute paths.
