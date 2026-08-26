# QuantXY Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver server-owned Agent definitions, versioning, permission requests, orchestration, execution, and immutable logs.

**Architecture:** Agent definitions are versioned and published; runtime authorization consumes the Plan 01 server guard; permission requests use the Plan 05 approval engine; orchestration stores a validated directed acyclic graph and fixed component versions.

**Tech Stack:** Next.js, TypeScript, Supabase PostgreSQL, DeepSeek adapter, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Depends on Plans 01, 05, 06, and 07.
- Browser input never owns system prompt, model, tools, tenant, or Agent authorization.
- Published versions and terminal execution logs are append-only.
- Formal empty data is an empty state, never a seeded Agent list.
- Agent orchestration is a manually authored, reviewed DAG only; advanced autonomous multi-Agent collaboration is Deferred.

---

### Task 1: Add versioned Agent definitions and publish commands

**Files:**
- Create: `supabase/migrations/202608260027_agent_versions.sql`
- Create: `supabase/tests/agent_runtime.sql`
- Create: `src/features/agents/agent-command-handler.ts`
- Create: `src/features/agents/agent-command-handler.test.ts`
- Create: `src/app/api/workstation/agents/route.ts`
- Create: `src/app/api/workstation/agents/[agentId]/versions/route.ts`
- Create: `src/app/api/workstation/agents/[agentId]/publish/route.ts`

**Interfaces:**
- Produces tables `agent_versions`, `agent_version_tools` and current-version reference.
- Produces create draft, add version, publish, disable commands requiring `agent.manage`.

- [ ] **Step 1: Write failing permission, immutable-version, and publish-validation tests**

```ts
expect((await createAgent(employeeSession)).status).toBe(403);
expect((await overwritePublishedVersion()).status).toBe(409);
expect((await publishWithoutModel()).status).toBe(422);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/agents/agent-command-handler.test.ts`
Expected: version command module is absent.

- [ ] **Step 3: Implement audited Agent version commands**

Store server-owned prompt/model/tools/data scopes, validate referenced tools and model configuration, publish by version lock, and append audit without raw secret values.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/agents/agent-command-handler.test.ts`
Run: `npm run db:test`
Expected: manager flow passes; employee, invalid model, overwrite and cross-tenant cases fail.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260027_agent_versions.sql supabase/tests/agent_runtime.sql src/features/agents/agent-command-handler.ts src/features/agents/agent-command-handler.test.ts src/app/api/workstation/agents/route.ts src/app/api/workstation/agents/[agentId]/versions/route.ts src/app/api/workstation/agents/[agentId]/publish/route.ts
git commit -m "feat: add versioned Agent definitions"
```

### Task 2: Add Agent permission requests and grants

**Files:**
- Create: `supabase/migrations/202608260028_agent_permission_requests.sql`
- Modify: `supabase/tests/agent_runtime.sql`
- Create: `src/features/agents/agent-permission-handler.ts`
- Create: `src/features/agents/agent-permission-handler.test.ts`
- Create: `src/app/api/workstation/agents/[agentId]/permission-requests/route.ts`

**Interfaces:**
- Produces `agent_permission_requests` linked to an approval instance.
- Approved request creates a scoped, expiring `agent_permissions` row.

- [ ] **Step 1: Write failing duplicate, approval, and expiry tests**

```ts
expect((await requestTwice()).requestIds).toHaveLength(1);
expect(permissionBeforeApproval).toBeNull();
expect(permissionAfterApproval.scopeMemberId).toBe(requesterId);
expect(await authorizeExpiredPermission()).toMatchObject({ code: "agent_forbidden" });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/agents/agent-permission-handler.test.ts`
Expected: request handler is absent.

- [ ] **Step 3: Implement approval-linked request and grant**

Use an idempotent request RPC, submit the configured approval template, and create the permission only from the approval completion transaction. Store grant actor, scope and expiry.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/agents/agent-permission-handler.test.ts`
Run: `npm run db:test`
Expected: duplicate request, approval linkage, grant scope, expiry and revocation pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260028_agent_permission_requests.sql supabase/tests/agent_runtime.sql src/features/agents/agent-permission-handler.ts src/features/agents/agent-permission-handler.test.ts src/app/api/workstation/agents/[agentId]/permission-requests/route.ts
git commit -m "feat: add Agent permission requests"
```

### Task 3: Add versioned Agent orchestration with DAG validation

**Files:**
- Create: `supabase/migrations/202608260029_agent_orchestration.sql`
- Modify: `supabase/tests/agent_runtime.sql`
- Create: `src/features/agents/orchestration-handler.ts`
- Create: `src/features/agents/orchestration-handler.test.ts`
- Create: `src/app/api/workstation/agent-orchestrations/route.ts`
- Create: `src/app/api/workstation/agent-orchestrations/[orchestrationId]/publish/route.ts`

**Interfaces:**
- Produces `agent_orchestrations`, versions, nodes and edges.
- `validateOrchestrationGraph(nodes, edges)` rejects cycles, disconnected outputs, incompatible contracts, and unauthorized Agent versions.

- [ ] **Step 1: Write failing cycle and contract tests**

```ts
expect(validateOrchestrationGraph(nodes, cyclicEdges)).toEqual({ ok: false, code: "orchestration_cycle" });
expect(validateOrchestrationGraph(nodes, incompatibleEdges)).toEqual({ ok: false, code: "orchestration_contract_mismatch" });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/agents/orchestration-handler.test.ts`
Expected: graph validator is absent.

- [ ] **Step 3: Implement validation and immutable publication**

Topologically sort the graph, validate node input/output schemas, pin published Agent version IDs, and write orchestration version/audit in one transaction.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/agents/orchestration-handler.test.ts`
Run: `npm run db:test`
Expected: valid DAG publishes; cycle, mismatch, unauthorized and cross-tenant nodes fail.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260029_agent_orchestration.sql supabase/tests/agent_runtime.sql src/features/agents/orchestration-handler.ts src/features/agents/orchestration-handler.test.ts src/app/api/workstation/agent-orchestrations/route.ts src/app/api/workstation/agent-orchestrations/[orchestrationId]/publish/route.ts
git commit -m "feat: add versioned Agent orchestration"
```

### Task 4: Make Agent and orchestration execution append-only

**Files:**
- Create: `supabase/migrations/202608260030_agent_execution_commands.sql`
- Modify: `supabase/tests/agent_runtime.sql`
- Create: `src/features/agents/agent-runtime-handler.ts`
- Create: `src/features/agents/agent-runtime-handler.test.ts`
- Create: `src/app/api/workstation/agents/[agentId]/runs/route.ts`
- Create: `src/app/api/workstation/agent-orchestrations/[orchestrationId]/runs/route.ts`

**Interfaces:**
- Produces start/append-step/complete/fail service RPCs with attempt tokens.
- Authenticated users can request an authorized run but cannot update result/token/cost/log fields.

- [ ] **Step 1: Write failing log-forgery, cross-tenant, and terminal-immutability tests**

```ts
expect((await directClientLogInsert()).status).toBe(403);
expect((await runCrossTenantAgent()).status).toBe(404);
expect((await mutateCompletedInvocation()).status).toBe(409);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/agents/agent-runtime-handler.test.ts`
Run: `npm run db:test`
Expected: current policies allow authenticated invocation updates/log inserts.

- [ ] **Step 3: Revoke client writes and implement service RPC lifecycle**

Run authorization before start, pin versions, append node logs through service RPC only, store safe summaries, and close every run exactly once.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/agents/agent-runtime-handler.test.ts`
Run: `npm run db:test`
Expected: forgery fails, authorized run succeeds, completed records remain immutable.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260030_agent_execution_commands.sql supabase/tests/agent_runtime.sql src/features/agents/agent-runtime-handler.ts src/features/agents/agent-runtime-handler.test.ts src/app/api/workstation/agents/[agentId]/runs/route.ts src/app/api/workstation/agent-orchestrations/[orchestrationId]/runs/route.ts
git commit -m "security: make Agent execution append-only"
```

### Task 5: Build the real Agent Center Next workspace

**Files:**
- Create: `src/app/(workspace)/agents/page.tsx`
- Create: `src/features/agents/agent-center-workspace.tsx`
- Create: `src/features/agents/agent-center-workspace.test.tsx`
- Create: `src/features/agents/agent-editor.tsx`
- Create: `src/features/agents/orchestration-editor.tsx`
- Create: `tests/e2e/agents.spec.ts`

**Interfaces:**
- Consumes Tasks 1-4 APIs and Plan 01 runtime authorization.
- Produces directory, capability overview, permission range, run history, editor and orchestration views.

- [ ] **Step 1: Write failing empty, denied, and real-run tests**

```tsx
expect(screen.getByText("尚未创建 Agent")).toBeInTheDocument();
expect(screen.queryByText("项目调度 Agent")).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "新建 Agent" })).not.toBeInTheDocument();
```

The manager case expects the create button and a server-returned run ID after execution.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/agents/agent-center-workspace.test.tsx`
Expected: Next Agent workspace is absent and fused contains the current UI.

- [ ] **Step 3: Implement responsive Agent Center**

Desktop uses directory/overview/history panels; mobile uses cards and full-screen editor/run detail. All actions use server capabilities and APIs; empty and failed states remain truthful.

- [ ] **Step 4: Verify GREEN and browser flow**

Run: `npx vitest run src/features/agents`
Run: `npx playwright test tests/e2e/agents.spec.ts --project=chrome`
Expected: create -> publish -> request/grant -> run -> inspect logs survives refresh and respects role/department/level.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(workspace)/agents/page.tsx' src/features/agents tests/e2e/agents.spec.ts
git commit -m "feat: deliver the real Agent Center"
```

### Task 6: Enforce Agent runtime allowlists, budgets, recovery and Kill Switch

**Files:**
- Create: `supabase/migrations/202608260040_agent_runtime_governance.sql`
- Modify: `supabase/tests/agent_runtime.sql`
- Modify: `src/features/agents/agent-runtime-handler.ts`
- Modify: `src/features/agents/agent-runtime-handler.test.ts`
- Create: `src/features/agents/agent-kill-switch.ts`
- Create: `src/features/agents/agent-kill-switch.test.ts`
- Create: `src/app/api/workstation/agents/runtime/kill-switch/route.ts`

**Interfaces:**
- Produces draft/test/published/retired lifecycle, tenant tool/data allowlists, secret references, budget/time/step/depth/concurrency limits and cancellation.
- Produces tenant-level admin-only `setTenantAgentKillSwitch(enabled, reason, requestId)`, requiring `agent.runtime.kill`; it atomically stops new claims, records queued/running cancellation/recovery semantics and appends immutable audit. Agent-specific stop is separate and never substitutes for the tenant control.

- [ ] **Step 1: Write failing lifecycle, allowlist, budget, loop, cancellation, human-node and Kill Switch tests**

```ts
expect((await invokeRetiredVersion()).status).toBe(409);
expect(await invokeDisallowedTool()).toMatchObject({ code: "agent_tool_forbidden" });
expect(await runBeyondStepLimit()).toMatchObject({ status: "failed", errorCode: "agent_step_limit" });
expect((await invokeAfterKillSwitch()).status).toBe(503);
expect(await toggleOtherTenantKillSwitch()).toMatchObject({ status: 404 });
expect(await workerClaimAfterTenantSwitch()).toMatchObject({ claimed: false, reason: "tenant_kill_switch" });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/agents/agent-runtime-handler.test.ts src/features/agents/agent-kill-switch.test.ts`
Run: `npm run db:test`
Expected: lifecycle/control limits and emergency stop behavior are incomplete.

- [ ] **Step 3: Implement server-enforced runtime controls**

Pin immutable published versions; run only authorized allowlisted tools and data scopes. Count budget, elapsed time, steps, recursion depth and tenant concurrency server-side; support cancel and human nodes, append safe tool/authorization logs, invoke compensations where defined and terminate detected loops. The tenant admin RPC/route requires `agent.runtime.kill`, updates the tenant switch and claim lease atomically, blocks new work, marks queued work cancelled, signals running work to cooperatively cancel and records resumable recovery handling without deleting append-only logs. Store secret references only, never secret values.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/agents`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/agents.spec.ts --project=chrome`
Expected: all limits, human controls, evaluation and Kill Switch behavior hold across tenant boundaries without autonomous multi-Agent execution.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260040_agent_runtime_governance.sql supabase/tests/agent_runtime.sql src/features/agents src/app/api/workstation/agents tests/e2e/agents.spec.ts
git commit -m "feat: govern Agent runtime and Kill Switch"
```
