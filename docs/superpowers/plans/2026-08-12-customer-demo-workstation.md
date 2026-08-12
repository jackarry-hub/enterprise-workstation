# Customer Demo Workstation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated customer demo that lets 10 realistic employees share one end-to-end decision, execution, acceptance, and archive workflow while switching identities safely.

**Architecture:** Add one canonical demo catalog that generates sessions, people records, project members, operation actors, and deterministic decision assignments. Enable the catalog only when `CUSTOMER_DEMO_MODE=true`; the demo shell stores the selected actor separately from the shared tenant-scoped workflow state. Reuse existing project and operations domain transitions, adding a reset coordinator and a one-click bundled deliverable for reliable live demos.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, Testing Library, Playwright, browser localStorage/IndexedDB demo repositories.

## Global Constraints

- Work only in `E:\企业工作站-客户演示版` on branch `codex/customer-demo`.
- Keep the existing visual system and routes; do not redesign unrelated screens.
- Demo mode must not require Supabase, OAuth, or copied production secrets.
- Production authentication behavior remains available when `CUSTOMER_DEMO_MODE` is not `true`.
- Business state uses one shared namespace for all 10 actors; selected identity uses a separate key.
- Every production behavior change follows red-green-refactor.
- Final verification includes unit tests, typecheck, lint, demo build, and a browser closed-loop test.

---

### Task 1: Canonical demo organization and sessions

**Files:**
- Create: `src/features/demo/customer-demo-data.ts`
- Create: `src/features/demo/customer-demo-data.test.ts`
- Modify: `src/features/hr/employee-mock-data.ts`
- Modify: `src/features/projects/mock-data.ts`
- Modify: `src/features/operations/operations-data.ts`

**Interfaces:**
- Produces: `customerDemoPeople`, `customerDemoSessions`, `customerDemoActors`, `customerDemoProjectMembers`, `getCustomerDemoPerson(id)`.
- Consumes: existing `WorkspaceSession`, `EmployeeProfile`, `MemberSummary`, and `WorkspaceActor` contracts.

- [ ] **Step 1: Write the failing catalog contract test**

```ts
expect(customerDemoPeople).toHaveLength(10);
expect(new Set(customerDemoPeople.map(({ id }) => id)).size).toBe(10);
expect(new Set(customerDemoPeople.map(({ role }) => role))).toEqual(
  new Set(["executive", "department_head", "employee", "finance", "hr"]),
);
expect(customerDemoSessions.map(({ actor }) => actor.name)).toEqual(
  customerDemoPeople.map(({ name }) => name),
);
```

- [ ] **Step 2: Run `npm test -- src/features/demo/customer-demo-data.test.ts` and verify it fails because the catalog does not exist**
- [ ] **Step 3: Implement the 10-person catalog with stable employee, member, actor, auth-user, department, manager, role, landing path, and responsibility fields**
- [ ] **Step 4: Derive HR people, project members, and operation actors from the catalog; preserve existing project-member ordering through explicit keys rather than duplicated records**
- [ ] **Step 5: Run the focused catalog and HR/project mock-data tests until green**
- [ ] **Step 6: Commit with `feat: add canonical customer demo organization`**

### Task 2: Demo-mode server entry and client identity switching

**Files:**
- Create: `src/features/demo/customer-demo-mode.ts`
- Create: `src/features/demo/customer-demo-session.test.tsx`
- Modify: `src/features/auth/workspace-session-provider.tsx`
- Modify: `src/components/shell/workspace-shell.tsx`
- Modify: `src/app/(workspace)/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/middleware.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `isCustomerDemoMode()`, `useCustomerDemoSession()`, `switchCustomerDemoActor(actorId)`, and `demoSessions?: readonly WorkspaceSession[]` on `WorkspaceShell`.
- Consumes: `customerDemoSessions` from Task 1.

- [ ] **Step 1: Write a failing provider test that switches from 林远 to 陈晨, updates `useWorkspaceSession()`, and persists only `enterprise-workstation.customer-demo.actor.v1`**

```tsx
await user.click(screen.getByRole("button", { name: "switch-demo-engineer" }));
expect(screen.getByTestId("current-name")).toHaveTextContent("陈晨");
expect(localStorage.getItem(CUSTOMER_DEMO_ACTOR_KEY)).toBe("demo-engineer");
```

- [ ] **Step 2: Run the provider test and verify the missing switch API is the failure**
- [ ] **Step 3: Add a stateful demo-session branch to `WorkspaceSessionProvider` while keeping the existing static-session behavior unchanged when no demo sessions are supplied**
- [ ] **Step 4: Make demo mode bypass Supabase middleware/session lookup and redirect `/` or `/login` to `/dashboard`; add Windows-safe `dev:demo` and `build:demo` scripts**
- [ ] **Step 5: Run provider, shell, route-policy, page, and login tests until green in both demo and non-demo paths**
- [ ] **Step 6: Commit with `feat: enable customer demo identity sessions`**

### Task 3: Shared workflow namespace and reset coordinator

**Files:**
- Create: `src/features/demo/customer-demo-state.ts`
- Create: `src/features/demo/customer-demo-state.test.ts`
- Modify: `src/features/operations/operation-actor-compat.ts`
- Modify: `src/features/operations/operation-actor-compat.test.ts`
- Modify: `src/features/operations/operations-identity-isolation.test.ts`

**Interfaces:**
- Produces: `CUSTOMER_DEMO_STORAGE_NAMESPACE`, `resetCustomerDemoState(storage)`, and explicit bindings for all 10 sessions.
- Consumes: storage key helpers for operations, decisions, projects, settings, and customers.

- [ ] **Step 1: Write failing tests proving all 10 demo sessions bind to their correct actor while returning the same storage namespace**

```ts
const contexts = customerDemoSessions.map(createOperationFixtureContext);
expect(contexts.every(({ actor }) => actor !== null)).toBe(true);
expect(new Set(contexts.map(({ storageNamespace }) => storageNamespace))).toEqual(
  new Set([CUSTOMER_DEMO_STORAGE_NAMESPACE]),
);
```

- [ ] **Step 2: Write a failing reset test that seeds all demo workflow keys, calls `resetCustomerDemoState`, and expects the shared keys removed while the selected actor key remains**
- [ ] **Step 3: Add exact 10-person identity bindings and one shared namespace without weakening existing real-session fail-closed tests**
- [ ] **Step 4: Implement the reset coordinator and dispatch existing change events so mounted screens reload their seed state immediately**
- [ ] **Step 5: Run compatibility, isolation, reset, operations, projects, and decision tests until green**
- [ ] **Step 6: Commit with `feat: share and reset customer demo workflow state`**

### Task 4: Deterministic 10-person decision and task story

**Files:**
- Modify: `src/features/decision-workbench/decision-workbench-data.ts`
- Modify: `src/features/decision-workbench/decision-workbench-data.test.ts`
- Modify: `src/features/operations/operations-data.ts`
- Modify: `src/features/operations/operations-data.test.ts`

**Interfaces:**
- Produces: a deterministic plan for “30 天完成星云智造 AI 企业工作站试点上线” with explicit assignees and department owners.
- Consumes: canonical project members and actors from Task 1.

- [ ] **Step 1: Write a failing plan test asserting the generated plan covers product, market, design, delivery, finance, and HR and assigns work to every non-executive demo person**

```ts
const assignees = plan.departments.flatMap(({ tasks }) => tasks.map(({ assignee }) => assignee.id));
expect(new Set(assignees)).toEqual(
  new Set(customerDemoPeople.filter(({ role }) => role !== "executive").map(({ memberId }) => memberId)),
);
```

- [ ] **Step 2: Run the plan test and verify it fails on missing demo people/departments**
- [ ] **Step 3: Replace the 13 generic definitions with 10 deterministic customer-pilot tasks, explicit preferred assignees, dependencies, acceptance criteria, and department owners**
- [ ] **Step 4: Update the seed operation story to include useful work and notifications for all 10 identities while keeping legal task transitions**
- [ ] **Step 5: Run decision, project creation, task transition, and operation summary tests until green**
- [ ] **Step 6: Commit with `feat: add customer pilot closed-loop scenario`**

### Task 5: Header switcher, reset action, and bundled deliverable

**Files:**
- Create: `public/demo-assets/客户试点成果说明.txt`
- Modify: `src/components/shell/workspace-header.tsx`
- Modify: `src/components/shell/workspace-shell.test.tsx`
- Modify: `src/features/operations/role-workbench.tsx`
- Modify: `src/features/operations/role-workbench.test.tsx`

**Interfaces:**
- Consumes: `useCustomerDemoSession()`, `resetCustomerDemoState()`, `storeOperationFile()`, and the current operation context.
- Produces: visible 10-person switch menu, reset confirmation, and `使用演示成果` action.

- [ ] **Step 1: Write a failing shell test that opens the user menu, sees 10 people, switches to 陈晨, and sees the employee landing navigation**
- [ ] **Step 2: Write a failing workbench test that attaches the bundled text file to an in-progress task and enables `提交验收` without opening a native file chooser**
- [ ] **Step 3: Implement the demo-only switcher and reset confirmation in the existing user menu, preserving the normal logout-only menu outside demo mode**
- [ ] **Step 4: Implement `使用演示成果` by fetching the bundled text file, wrapping it in a real `File`, and storing it through the existing IndexedDB operation file path**
- [ ] **Step 5: Run shell and role-workbench tests until green; verify keyboard labels and focus behavior**
- [ ] **Step 6: Commit with `feat: add reliable customer demo controls`**

### Task 6: Full-flow browser verification and handoff

**Files:**
- Create: `tests/e2e/customer-demo-closure.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `README.md`
- Modify: `docs/企业工作站使用说明.md`

**Interfaces:**
- Consumes: demo scripts, switch menu, deterministic scenario, and reset action from Tasks 1–5.
- Produces: one repeatable browser acceptance test and concise operator instructions.

- [ ] **Step 1: Write a browser test that resets the scenario, switches to 陈晨, completes a ready task with the bundled deliverable, switches to 张伟, rejects it, switches back to 陈晨 to resubmit, and switches to 张伟 to accept**
- [ ] **Step 2: Run only the browser test and verify the first missing or incorrect interaction fails with a useful assertion**
- [ ] **Step 3: Fix only behavior exposed by the failing browser test, adding focused regression tests before each production fix**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:demo`, and `npx playwright test tests/e2e/customer-demo-closure.spec.ts`**
- [ ] **Step 5: Start `npm run dev:demo -- -p 3007`, inspect dashboard, switcher, employee execution, manager acceptance, and reset at desktop and mobile widths, and capture any visual defects as regression tests before fixing**
- [ ] **Step 6: Update the instructions with the exact start command, fixed demo story, identity order, reset location, and fallback recovery**
- [ ] **Step 7: Commit with `test: verify customer demo closed loop`**

## Self-review

- Every design requirement maps to at least one task.
- All new interfaces are introduced before consumers use them.
- Production-auth behavior has an explicit non-demo regression path.
- The plan contains no unresolved placeholders and no optional implementation branches.
- Identity persistence and workflow persistence are deliberately separate.
