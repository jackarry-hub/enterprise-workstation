# QuantXY Project, Task, Activity, and File Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete project execution chain with transactional projects, activities, tasks, reports, files, and durable Feishu notifications.

**Architecture:** PostgreSQL RPCs own state transitions and audit; Route Handlers validate commands and map errors; Next.js list/detail pages consume real repositories. Storage and Feishu side effects are driven by verified file completion and a durable outbox.

**Tech Stack:** Next.js, TypeScript, Supabase PostgreSQL/Storage, Feishu OpenAPI, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Depends on Plans 01 and 02.
- Every multi-table write is transactional and idempotent.
- File metadata is not success until the uploaded object is verified.
- Feishu delivery never determines whether the task transaction committed.
- No fixture or IndexedDB business repository remains in formal pages.

---

### Task 1: Add transactional project lifecycle commands

**Files:**
- Create: `supabase/migrations/202608270004_project_lifecycle_commands.sql` (forward-only after the shipped `202608270002/003` constraint rebuilds)
- Create: `supabase/tests/project_lifecycle.sql`
- Create: `supabase/tests/project_lifecycle_concurrency.sql`
- Modify: `src/app/api/workstation/projects/handler.test.ts`
- Modify: `src/app/api/workstation/projects/handler.ts`
- Create: `src/app/api/workstation/projects/[projectId]/route.ts`
- Create: `src/features/projects/project-command-handler.ts`
- Create: `src/features/projects/project-command-handler.test.ts`
- Modify: `src/features/workstation/server-bootstrap.ts`
- Modify: `src/app/api/workstation/bootstrap/handler.ts`
- Modify: `public/workstation-server-adapter.js`
- Modify: `quantxy-ai-workbench-fused.html`
- Modify: `src/middleware.ts`
- Modify: `src/middleware.test.ts`
- Modify: `tests/html-workstation-server-adapter.test.mjs`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`

**Interfaces:**
- Produces RPCs `create_current_project_v2`, `update_current_project`, `archive_current_project`.
- Commands include `idempotencyKey`, `version`, `name`, `ownerPublicId`, `budgetAmount`, `startsOn`, `dueOn`.

- [x] **Step 1: Write failing atomicity, money-validation, and idempotency tests**

```ts
expect((await createProject({ ...input, budgetAmount: "abc" })).status).toBe(400);
expect(await concurrentCreateSameKey()).toHaveLength(1);
expect(projectWithoutMembershipAfterInjectedFailure).toBeNull();
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/app/api/workstation/projects/handler.test.ts src/features/projects/project-command-handler.test.ts`
Expected: invalid budget becomes zero and the current multi-step insert is not atomic.

- [x] **Step 3: Implement RPC-backed create/update/archive**

Use numeric strings parsed by the server money utility. RPC creates project, owner membership, audit and idempotency result atomically; update/archive use version comparison.

- [ ] **Step 4: Verify GREEN and DB failure rollback**

Local TypeScript, HTML, security, build, static pgTAP, and independent-review gates pass. Clean Supabase reset plus live pgTAP execution remains a required pre-release gate because this workstation has no local PostgreSQL/Supabase runtime.

Run: `npx vitest run src/app/api/workstation/projects/handler.test.ts src/features/projects/project-command-handler.test.ts`
Run: `npm run db:test`
Expected: invalid money is 400, duplicate key returns the same entity, injected membership failure rolls back.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-08-26-quantxy-03-project-task-delivery.md supabase/migrations/202608270004_project_lifecycle_commands.sql supabase/tests/project_lifecycle.sql supabase/tests/project_lifecycle_concurrency.sql src/app/api/workstation/projects/handler.test.ts src/app/api/workstation/projects/handler.ts src/app/api/workstation/projects/[projectId]/route.ts src/features/projects/project-command-handler.ts src/features/projects/project-command-handler.test.ts src/features/workstation/server-bootstrap.ts src/features/workstation/server-bootstrap.test.ts src/app/api/workstation/bootstrap/handler.ts public/workstation-server-adapter.js quantxy-ai-workbench-fused.html src/middleware.ts src/middleware.test.ts tests/html-workstation-server-adapter.test.mjs tests/html-personal-workbench-behavior.test.mjs
git commit -m "feat: add transactional project lifecycle"
```

### Task 2: Add milestone, risk, activity, report, comment, and dependency commands

**Files:**
- Create: `supabase/migrations/202608260014_project_execution_commands.sql`
- Create: `supabase/tests/project_execution.sql`
- Create: `src/features/projects/execution-command-handler.ts`
- Create: `src/features/projects/execution-command-handler.test.ts`
- Create: `src/app/api/workstation/projects/[projectId]/milestones/route.ts`
- Create: `src/app/api/workstation/projects/[projectId]/risks/route.ts`
- Create: `src/app/api/workstation/projects/[projectId]/activities/route.ts`
- Create: `src/app/api/workstation/projects/[projectId]/reports/route.ts`
- Create: `src/app/api/workstation/tasks/[taskId]/comments/route.ts`
- Create: `src/app/api/workstation/tasks/[taskId]/dependencies/route.ts`

**Interfaces:**
- Produces audited RPC commands for each named child resource.
- Dependency command rejects self-dependency and cycles with `task_dependency_cycle`.

- [ ] **Step 1: Write failing permission and cycle tests**

```ts
expect((await createRisk(unrelatedEmployeeRequest)).status).toBe(403);
expect((await createDependency({ taskId: a, dependsOn: a })).status).toBe(422);
expect((await createDependency({ taskId: a, dependsOn: cInExistingCycle })).status).toBe(422);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/projects/execution-command-handler.test.ts`
Expected: handler and routes are absent.

- [ ] **Step 3: Implement project-member scoped RPCs**

Each RPC resolves project membership from session, validates dates/status, writes the child entity and audit row, and returns the public entity representation.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/projects/execution-command-handler.test.ts`
Run: `npm run db:test`
Expected: authorized commands persist; unrelated/cross-tenant commands fail; dependency cycles are rejected.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260014_project_execution_commands.sql supabase/tests/project_execution.sql src/features/projects/execution-command-handler.ts src/features/projects/execution-command-handler.test.ts src/app/api/workstation/projects/[projectId]/milestones/route.ts src/app/api/workstation/projects/[projectId]/risks/route.ts src/app/api/workstation/projects/[projectId]/activities/route.ts src/app/api/workstation/projects/[projectId]/reports/route.ts src/app/api/workstation/tasks/[taskId]/comments/route.ts src/app/api/workstation/tasks/[taskId]/dependencies/route.ts
git commit -m "feat: add project execution commands"
```

### Task 3: Make task batches atomic, idempotent, and fully audited

**Files:**
- Create: `supabase/migrations/202608260015_task_command_v2.sql`
- Create: `supabase/tests/task_workflow.sql`
- Modify: `src/app/api/workstation/tasks/batch/handler.test.ts`
- Modify: `src/app/api/workstation/tasks/batch/handler.ts`
- Modify: `src/app/api/workstation/tasks/[taskId]/handler.test.ts`
- Modify: `src/app/api/workstation/tasks/[taskId]/handler.ts`

**Interfaces:**
- Produces RPC `create_current_task_batch_v2(items jsonb, idempotency_key uuid, request_id uuid)`.
- Produces RPC `transition_current_task(task_public_id uuid, command text, expected_version integer, payload jsonb, request_id uuid)`.

- [ ] **Step 1: Write failing half-batch, duplicate, and transition audit tests**

```ts
expect(await batchAfterInjectedItemFailure()).toHaveLength(0);
expect((await repeatBatchWithSameKey()).taskIds).toEqual(firstResult.taskIds);
expect(await transitionAudit(taskId)).toMatchObject({ action: "task.submitted", actorId });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/app/api/workstation/tasks/batch/handler.test.ts src/app/api/workstation/tasks/[taskId]/handler.test.ts`
Expected: current batch can partially commit and transitions lack audit.

- [ ] **Step 3: Replace loops and direct updates with RPCs**

Validate one to twenty items before the RPC, create the whole batch in one transaction, and route claim/progress/submit/review/reopen through the transition state machine.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/app/api/workstation/tasks/batch/handler.test.ts src/app/api/workstation/tasks/[taskId]/handler.test.ts`
Run: `npm run db:test`
Expected: rollback, duplicate replay, version conflict, actor rules and audit cases pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260015_task_command_v2.sql supabase/tests/task_workflow.sql src/app/api/workstation/tasks/batch/handler.test.ts src/app/api/workstation/tasks/batch/handler.ts src/app/api/workstation/tasks/[taskId]/handler.test.ts src/app/api/workstation/tasks/[taskId]/handler.ts
git commit -m "feat: make task workflows atomic and auditable"
```

### Task 4: Add verified signed file upload and relations

**Files:**
- Create: `supabase/migrations/202608260016_file_storage_commands.sql`
- Create: `supabase/tests/file_storage.sql`
- Create: `src/features/files/file-command-handler.ts`
- Create: `src/features/files/file-command-handler.test.ts`
- Create: `src/app/api/workstation/files/upload-url/route.ts`
- Create: `src/app/api/workstation/files/complete/route.ts`
- Modify: `src/features/projects/components/project-files-tab.tsx`
- Modify: `src/features/operations/file-storage.ts`

**Interfaces:**
- Produces `POST /api/workstation/files/upload-url` -> `{ uploadUrl, objectPath, expiresAt }`.
- Produces `POST /api/workstation/files/complete` -> verified `FileRecord`.

- [ ] **Step 1: Write failing scope, type, size, and missing-object tests**

```ts
expect((await requestUploadUrl(crossProjectRequest)).status).toBe(404);
expect((await completeUpload({ objectPath: missingPath })).status).toBe(422);
expect((await requestUploadUrl({ mime: "application/x-msdownload" })).status).toBe(415);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/files/file-command-handler.test.ts src/features/operations/file-storage.test.ts`
Expected: formal upload commands do not exist and project UI uses local storage behavior.

- [ ] **Step 3: Implement two-phase upload verification**

Create tenant-scoped object paths, short-lived signed upload URLs, server-side object metadata verification, file row/relation transaction, and cleanup for abandoned objects.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/files/file-command-handler.test.ts src/features/operations/file-storage.test.ts`
Run: `npm run db:test`
Expected: valid file persists; forbidden project, disallowed type, oversize and missing object fail.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260016_file_storage_commands.sql supabase/tests/file_storage.sql src/features/files/file-command-handler.ts src/features/files/file-command-handler.test.ts src/app/api/workstation/files/upload-url/route.ts src/app/api/workstation/files/complete/route.ts src/features/projects/components/project-files-tab.tsx src/features/operations/file-storage.ts
git commit -m "feat: add verified business file uploads"
```

### Task 5: Persist every Feishu notification delivery transition

**Files:**
- Create: `supabase/migrations/202608260017_notification_outbox_v2.sql`
- Create: `supabase/tests/notification_outbox.sql`
- Modify: `src/features/workstation/task-notification.test.ts`
- Modify: `src/features/workstation/task-notification.ts`
- Modify: `src/features/workstation/task-notification-batch.test.ts`
- Modify: `src/features/workstation/task-notification-batch.ts`

**Interfaces:**
- Produces claim/complete/fail RPCs keyed by notification ID and attempt token.
- Removes process-local `unconfirmedDeliveries` as source of reconciliation truth.

- [ ] **Step 1: Write failing restart and duplicate-delivery tests**

```ts
expect(await recoverAfterProcessRestart(notificationId)).toEqual({ action: "reconcile", messageId });
expect(await concurrentClaims(notificationId)).toHaveLength(1);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/workstation/task-notification.test.ts src/features/workstation/task-notification-batch.test.ts`
Expected: restart loses the in-memory delivery record.

- [ ] **Step 3: Implement database-backed attempts and reconciliation**

Persist attempt token before send, message ID immediately after send, and final state in a separate transaction. Retry reads DB state and never relies on an in-process Map.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/workstation/task-notification.test.ts src/features/workstation/task-notification-batch.test.ts`
Run: `npm run db:test`
Expected: one claim wins; restart recovery and duplicate protection pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260017_notification_outbox_v2.sql supabase/tests/notification_outbox.sql src/features/workstation/task-notification.test.ts src/features/workstation/task-notification.ts src/features/workstation/task-notification-batch.test.ts src/features/workstation/task-notification-batch.ts
git commit -m "feat: persist Feishu notification delivery state"
```

### Task 6: Replace project, activity, task, and workspace fixtures with real responsive UI

**Files:**
- Modify: `src/features/projects/projects-workspace.tsx`
- Modify: `src/features/projects/project-detail-workspace.tsx`
- Modify: `src/features/projects/projects-page.test.tsx`
- Modify: `src/features/projects/project-detail-page.test.tsx`
- Modify: `src/features/activities/activities-page.tsx`
- Modify: `src/features/activities/activities-page.test.tsx`
- Modify: `src/features/tasks/task-center-workspace.tsx`
- Modify: `src/features/tasks/task-center-page.test.tsx`
- Modify: `src/features/tasks/components/workspace-daily-report.tsx`
- Modify: `tests/e2e/projects-closure.spec.ts`
- Create: `tests/e2e/task-workflow.spec.ts`

**Interfaces:**
- Consumes Tasks 1-5 APIs and repositories.
- Produces desktop table/detail UI and mobile list/full-screen-detail UI with no fixture gating.

- [ ] **Step 1: Write failing real-session and refresh-persistence tests**

```tsx
expect(screen.getByText(realProject.name)).toBeInTheDocument();
expect(screen.queryByText(/演示/)).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "保存日报" }));
expect(api.createReport).toHaveBeenCalledWith(expect.objectContaining({ projectId, taskIds }));
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/projects/projects-page.test.tsx src/features/projects/project-detail-page.test.tsx src/features/activities/activities-page.test.tsx src/features/tasks/task-center-page.test.tsx`
Expected: non-fixture project/task data is cleared and report save is local-only.

- [ ] **Step 3: Connect real repositories and responsive mutation dialogs**

Remove fixture/local repository branches. After every mutation, revalidate or reload server data. Mobile uses cards and full-screen sheets; desktop keeps tables and side panels.

- [ ] **Step 4: Verify GREEN and full project chain**

Run: `npx vitest run src/features/projects src/features/activities src/features/tasks`
Run: `npx playwright test tests/e2e/projects-closure.spec.ts tests/e2e/task-workflow.spec.ts --project=chrome`
Expected: project -> milestone -> task -> report -> submit -> review survives refresh and uses real DB rows.

- [ ] **Step 5: Commit**

```bash
git add src/features/projects src/features/activities src/features/tasks tests/e2e/projects-closure.spec.ts tests/e2e/task-workflow.spec.ts
git commit -m "feat: deliver the real project execution workspace"
```

### Task 7: Complete membership, acceptance, history/archive and durable recipient notifications

**Files:**
- Create: `supabase/migrations/202608260040_project_commercial_completion.sql`
- Modify: `supabase/tests/project_execution.sql`
- Modify: `supabase/tests/notification_outbox.sql`
- Modify: `src/features/projects/execution-command-handler.ts`
- Modify: `src/features/workstation/task-notification.ts`
- Create: `src/app/api/workstation/projects/[projectId]/members/route.ts`
- Create: `src/app/api/workstation/projects/[projectId]/restore/route.ts`

**Interfaces:**
- Produces member add/remove/role, milestone/acceptance, archive/restore and immutable history commands with tenant-scoped optimistic versions.
- Produces recipient notification states `pending|sending|sent|failed|read`, attempt locks, retry schedule and a tenant+recipient+event dedupe key.

- [ ] **Step 1: Write failing member-scope, acceptance, restore and notification retry/read tests**

```ts
expect((await addProjectMember(unrelatedSession)).status).toBe(403);
expect((await acceptTask(staleVersion)).status).toBe(409);
expect(await replayNotificationEvent()).toHaveLength(1);
expect((await markRecipientRead()).readAt).not.toBeNull();
```

- [x] **Step 2: Verify RED**

Run: `npx vitest run src/features/projects src/features/workstation/task-notification`
Run: `npm run db:test`
Expected: member lifecycle, explicit acceptance/history/restore and recipient read state are incomplete.

- [ ] **Step 3: Implement the bounded commercial closure**

Use transaction RPCs for project membership, activities, milestones, task/subtask/dependency, due date, acceptance criteria, reports, comments, verified file relations, history, archive and restore. Persist notification recipient/read/retry/dedupe data; workers claim with an attempt token and only retry failures from durable state.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/projects src/features/activities src/features/tasks src/features/workstation/task-notification`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/projects-closure.spec.ts tests/e2e/task-workflow.spec.ts --project=chrome`
Expected: the complete project closure survives refresh and cross-role authorization; no duplicate notification is delivered.

- [x] **Step 5: Commit the independently reviewable Task 1 boundary**

```bash
git add supabase/migrations/202608260040_project_commercial_completion.sql supabase/tests/project_execution.sql supabase/tests/notification_outbox.sql src/features/projects src/features/workstation/task-notification.ts src/app/api/workstation/projects tests/e2e/projects-closure.spec.ts tests/e2e/task-workflow.spec.ts
git commit -m "feat: complete project membership and notification durability"
```
