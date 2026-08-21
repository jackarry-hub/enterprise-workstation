# Feishu Batch Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an approved task batch and send at most one Feishu assignment card per employee.

**Architecture:** Add a batch route that reuses the existing task creation RPC, defers delivery until every task exists, then groups notification contexts by recipient open_id. Record the same provider message ID on each task notification in the group and return per-task safe delivery states.

**Tech Stack:** Next.js route handlers, Supabase service-role scoped RPCs, Feishu OpenAPI, Vitest, standalone HTML/jsdom

**Spec:** `docs/superpowers/specs/2026-08-21-ai-talent-notification-design.md`

## Global Constraints

- A batch contains 1 to 20 tasks.
- One recipient receives at most one card per approved batch.
- No raw Feishu or Supabase error is returned to the browser.
- Existing single-task creation and retry remain supported.

---

### Task 1: Batch card and grouped dispatcher

**Files:**
- Modify: `src/features/feishu/task-notification.ts`
- Modify: `src/features/feishu/task-notification.test.ts`
- Create: `src/features/workstation/task-notification-batch.ts`
- Create: `src/features/workstation/task-notification-batch.test.ts`

**Interfaces:**
- Produces: `sendFeishuTaskBatchNotification(input, env)`.
- Produces: `dispatchTaskAssignmentBatch(scopes)` returning one safe status per task.

- [ ] **Step 1: Write failing tests** proving two tasks for one open_id produce one send, different recipients produce separate sends, and results are recorded for every task.
- [ ] **Step 2: Run focused tests and confirm missing interfaces.**
- [ ] **Step 3: Implement the compact interactive card and grouped dispatcher.**
- [ ] **Step 4: Run focused tests.**

### Task 2: Batch task API

**Files:**
- Create: `src/app/api/workstation/tasks/batch/handler.ts`
- Create: `src/app/api/workstation/tasks/batch/handler.test.ts`
- Create: `src/app/api/workstation/tasks/batch/route.ts`
- Modify: `src/app/api/workstation/tasks/handler.ts`

**Interfaces:**
- Produces: authenticated `POST /api/workstation/tasks/batch` with `{ tasks: TaskCreateBody[] }`.
- Returns: `{ tasks: Array<{ task, notification }> }` with stable public notification statuses.

- [ ] **Step 1: Extract and test reusable task input parsing without changing behavior.**
- [ ] **Step 2: Write failing batch handler tests** for authorization, 20-item limit, task creation and grouped notification results.
- [ ] **Step 3: Implement the batch handler and route.**
- [ ] **Step 4: Run focused task route tests.**

### Task 3: Browser batch issue flow

**Files:**
- Modify: `public/workstation-server-adapter.js`
- Modify: `public/quantxy-ai-workbench-fused.html`
- Modify: `tests/html-workstation-server-adapter.test.mjs`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`

**Interfaces:**
- Produces: `WORKSTATION_GATEWAY.createTasks(inputs)`.
- Produces: one batch request and a delivery summary toast.

- [ ] **Step 1: Write failing tests** that one approved schedule calls `createTasks` once and shows sent/unavailable counts.
- [ ] **Step 2: Run focused HTML tests and confirm failure.**
- [ ] **Step 3: Implement adapter and issue-flow integration with a fallback to single creation only in demo mode.**
- [ ] **Step 4: Run the full HTML suite.**

### Task 4: End-to-end verification

- [ ] **Step 1: Run `npm test`.**
- [ ] **Step 2: Run `npm run typecheck`, `npm run lint` and `npm run build`.**
- [ ] **Step 3: Run `docker compose config`.**
- [ ] **Step 4: Verify the diff contains no `.env`, API key, app secret or open_id values.**
