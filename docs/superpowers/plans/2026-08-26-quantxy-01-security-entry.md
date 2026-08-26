# QuantXY Security and Single Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the known P0 authorization leaks and establish one fail-closed Next.js commercial entry contract.

**Architecture:** Extend the existing workspace session and PostgreSQL permission helpers, move sensitive mutations behind tenant-scoped RPCs, and make module availability a server-derived capability. The current salary WIP is completed in place before any later module plan starts.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5, Supabase/PostgreSQL RLS, Vitest 4, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Next.js is the only final commercial UI; do not add features to fused HTML except removal or migration compatibility.
- Do not deploy or write production data.
- Formal mode must never load mock, seed, fixture, or business localStorage data.
- Actor, tenant, and organization come only from the verified workspace session.
- Every production change follows test RED -> implementation GREEN -> refactor.
- Leave and attendance stay hidden and are not implemented.
- Local synthetic data must still use real adapters and persistence; production data/credentials never enter Local, CI/Test or Staging. Internal/Customer Production require explicit authorization.

**Execution status boundary:** Tasks 1-6 were completed and independently reviewed at implementation HEAD `5467c97`; preserve their history and continue from the current execution position. Plan02 Task1 owns the sole environment/DB guard and shared phase scripts; Plan10 only consumes/verifies them. This plan does not restart completed tasks or absorb later migration, HTTP/security, operations or release evidence work.

---

### Task 1: Add the commercial permission catalog and runtime invariant

**Files:**
- Create: `src/features/commercial/production-mode.ts`
- Create: `src/features/commercial/production-mode.test.ts`
- Modify: `src/features/auth/workspace-session-types.ts`
- Modify: `src/features/auth/workspace-access.ts`
- Modify: `src/features/auth/workspace-access.test.ts`
- Create: `supabase/migrations/202608260001_commercial_permissions.sql`
- Create: `supabase/tests/commercial_permissions.sql`

**Interfaces:**
- Produces: `assertCommercialRuntime(env: NodeJS.ProcessEnv): void`
- Produces permission literals `ai.config.manage`, `role.manage`, `customer.manage`, `approval.submit`, `approval.act`, `expense.manage`, `knowledge.manage`, `agent.manage`, `agent.orchestrate`, `analytics.read`, `settings.manage`.

- [ ] **Step 1: Write failing permission and production-mode tests**

```ts
expect(() => assertCommercialRuntime({ NODE_ENV: "production", WORKSTATION_DEMO_ENABLED: "true" } as NodeJS.ProcessEnv))
  .toThrow("commercial_runtime_rejects_demo");
expect(parseWorkspaceAccess({ ...baseAccess, permissionCodes: ["ai.config.manage"] })?.permissionCodes)
  .toContain("ai.config.manage");
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/commercial/production-mode.test.ts src/features/auth/workspace-access.test.ts`
Expected: FAIL because the module and permission literal do not exist.

- [ ] **Step 3: Implement the invariant and seed permissions**

```ts
export function assertCommercialRuntime(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV === "production" && env.WORKSTATION_DEMO_ENABLED === "true") {
    throw new Error("commercial_runtime_rejects_demo");
  }
}
```

The migration inserts the exact permission codes idempotently and grants owner/admin only; no employee role receives management permissions.

- [ ] **Step 4: Verify GREEN, reset a local database, and run DB tests**

Run: `npx vitest run src/features/commercial/production-mode.test.ts src/features/auth/workspace-access.test.ts`
Run: `npm run db:reset`
Run: `npm run db:test`
Expected: all commands exit 0 and the permission matrix rejects employee management access.

- [ ] **Step 5: Commit only this task**

```bash
git add src/features/commercial/production-mode.ts src/features/commercial/production-mode.test.ts src/features/auth/workspace-session-types.ts src/features/auth/workspace-access.ts src/features/auth/workspace-access.test.ts supabase/migrations/202608260001_commercial_permissions.sql supabase/tests/commercial_permissions.sql
git commit -m "security: add commercial permission baseline"
```

### Task 2: Restrict AI provider configuration and audit every change

**Files:**
- Modify: `src/features/ai-config/ai-config-handler.test.ts`
- Modify: `src/features/ai-config/ai-config-handler.ts`
- Modify: `src/features/ai-config/ai-config-store.ts`
- Create: `supabase/migrations/202608260002_ai_config_command.sql`
- Modify: `supabase/tests/commercial_permissions.sql`

**Interfaces:**
- Consumes: workspace permission `ai.config.manage`.
- Produces: RPC `update_current_ai_provider_config(provider text, model text, encrypted_key text, key_hint text, request_id uuid)`.

- [ ] **Step 1: Write failing employee-denial and admin-audit tests**

```ts
expect((await handleAiConfigPut({ session: employeeSession, body, store })).status).toBe(403);
expect((await handleAiConfigPut({ session: aiAdminSession, body, store })).status).toBe(200);
expect(store.update).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.any(String) }));
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/ai-config/ai-config-handler.test.ts`
Expected: the employee request currently succeeds, so the denial assertion fails.

- [ ] **Step 3: Enforce the permission and use the audited RPC**

```ts
function canManage(session: WorkspaceSession) {
  return session.permissionCodes.includes("ai.config.manage");
}
```

Replace service-role table upsert with the named RPC. The RPC derives tenant and actor from `auth.uid()`, writes the encrypted value, and appends an `ai.config.updated` audit row without secret material.

- [ ] **Step 4: Verify GREEN and DB authorization**

Run: `npx vitest run src/features/ai-config/ai-config-handler.test.ts src/features/ai-config/ai-config-store.test.ts`
Run: `npm run db:test`
Expected: employee receives 403; authorized admin succeeds; audit assertion passes.

- [ ] **Step 5: Commit**

```bash
git add src/features/ai-config/ai-config-handler.test.ts src/features/ai-config/ai-config-handler.ts src/features/ai-config/ai-config-store.ts supabase/migrations/202608260002_ai_config_command.sql supabase/tests/commercial_permissions.sql
git commit -m "security: restrict and audit AI configuration"
```

### Task 3: Close salary bootstrap privacy and matching defects

**Files:**
- Modify: `src/app/api/workstation/bootstrap/handler.test.ts`
- Modify: `src/app/api/workstation/bootstrap/handler.ts`
- Modify: `src/features/workstation/server-bootstrap.test.ts`
- Modify: `src/features/workstation/server-bootstrap.ts`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html`
- Create: `supabase/migrations/202608260003_salary_policy_privacy.sql`
- Create: `supabase/tests/sensitive_rls_matrix.sql`

**Interfaces:**
- Produces: `parseNullableNumber(value: unknown): number | null`.
- Produces: `matchSalaryPolicy({ departmentId, jobFamily, gradeCode, jobLevel, effectiveOn }): SalaryPolicy | null`.
- Changes bootstrap contract so non-`salary.manage` sessions receive salary band only for the current member.

- [ ] **Step 1: Add failing tests for privacy, null, job family, and level 20**

```ts
expect(employeeBootstrap.members.find((member) => member.id !== employeeId)?.salaryBand).toBeUndefined();
expect(parseNullableNumber(null)).toBeNull();
expect(matchSalaryPolicy({ ...subject, jobFamily: "engineering" })?.jobFamily).toBe("engineering");
expect(memberLevelValue({ jobLevel: 20 })).toBe(20);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/app/api/workstation/bootstrap/handler.test.ts src/features/workstation/server-bootstrap.test.ts`
Run: `node --test tests/html-personal-workbench-behavior.test.mjs`
Expected: tests expose other-member bands, null becomes zero, and level is clamped to five.

- [ ] **Step 3: Implement scoped projection and exact matching**

Use scalar `department_id` and `job_family` fields, map departments after query, preserve null, and remove the level-five clamp. The migration replaces the all-member salary-policy SELECT policy with self-only RPC access plus `salary.manage` management access.

- [ ] **Step 4: Verify GREEN and sensitive RLS**

Run: `npx vitest run src/app/api/workstation/bootstrap/handler.test.ts src/features/workstation/server-bootstrap.test.ts`
Run: `node --test tests/html-personal-workbench-behavior.test.mjs`
Run: `npm run db:test`
Expected: no other-member salary band is serialized and both self/manager DB cases pass.

- [ ] **Step 5: Commit the existing WIP only after the gate passes**

```bash
git add quantxy-ai-workbench-fused.html src/app/api/workstation/bootstrap/handler.test.ts src/app/api/workstation/bootstrap/handler.ts src/features/workstation/server-bootstrap.test.ts src/features/workstation/server-bootstrap.ts tests/html-personal-workbench-behavior.test.mjs supabase/migrations/202608260003_salary_policy_privacy.sql supabase/tests/sensitive_rls_matrix.sql
git commit -m "security: isolate salary policies in workstation bootstrap"
```

### Task 4: Lock approval reads and direct writes until the real workflow lands

**Files:**
- Create: `supabase/migrations/202608260004_approval_privacy_lock.sql`
- Modify: `supabase/tests/sensitive_rls_matrix.sql`
- Modify: `src/features/approvals/approval-pages.test.tsx`
- Modify: `src/features/approvals/approval-detail-page.tsx`

**Interfaces:**
- Produces participant-scoped SELECT policies for approvals, steps, and actions.
- Revokes authenticated table INSERT/UPDATE/DELETE on approval workflow tables.

- [ ] **Step 1: Write failing DB and UI tests**

```ts
expect(screen.queryByRole("button", { name: "同意" })).not.toBeInTheDocument();
expect(screen.getByText("审批操作将在安全流程接通后开放")).toBeInTheDocument();
```

The pgTAP case creates two employees and asserts the unrelated employee reads zero rows and cannot insert `approval_actions`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/approvals/approval-pages.test.tsx`
Run: `npm run db:test`
Expected: current UI exposes local action buttons and current policies allow broad reads/writes.

- [ ] **Step 3: Apply participant RLS and remove fake-success actions**

Keep real read-only details for authorized participants. Render no mutation button until Plan 05 adds the transactional command.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/approvals/approval-pages.test.tsx src/features/approvals/approval-data.test.ts`
Run: `npm run db:test`
Expected: participant reads work; unrelated employee and direct table writes fail.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260004_approval_privacy_lock.sql supabase/tests/sensitive_rls_matrix.sql src/features/approvals/approval-pages.test.tsx src/features/approvals/approval-detail-page.tsx
git commit -m "security: lock approval data to participants"
```

### Task 5: Enforce Agent invocation authorization on the server

**Files:**
- Create: `src/features/agents/authorize-agent-invocation.ts`
- Create: `src/features/agents/authorize-agent-invocation.test.ts`
- Modify: `src/features/ai-config/ai-chat-handler.ts`
- Modify: `src/features/ai-config/ai-chat-handler.test.ts`
- Modify: `src/features/workstation/agent-invocation-recorder.ts`
- Modify: `src/features/workstation/agent-invocation-recorder.test.ts`
- Modify: `quantxy-ai-workbench-fused.html`

**Interfaces:**
- Produces: `authorizeAgentInvocation(client, session, agentPublicId): Promise<AuthorizedAgent>`.
- `AuthorizedAgent` contains server-owned `definitionId`, `version`, `systemPrompt`, `model`, and `toolCodes`.

- [ ] **Step 1: Write failing cross-tenant, department, level, and prompt tests**

```ts
await expect(authorizeAgentInvocation(client, sessionA, tenantBAgentId)).rejects.toMatchObject({ code: "agent_not_found" });
await expect(authorizeAgentInvocation(client, lowLevelSession, restrictedAgentId)).rejects.toMatchObject({ code: "agent_forbidden" });
expect(providerRequest.system).toBe(databaseAgent.systemPrompt);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/agents/authorize-agent-invocation.test.ts src/features/ai-config/ai-chat-handler.test.ts src/features/workstation/agent-invocation-recorder.test.ts`
Expected: authorization module is absent and chat accepts client-owned Agent truth.

- [ ] **Step 3: Implement server authorization and remove formal seed fallback**

Query Agent by public ID plus session tenant/org, enforce enabled status and permission intersection, and build the provider request from the authorized server definition. Replace formal `seedAgents()` with explicit empty/error rendering.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/agents/authorize-agent-invocation.test.ts src/features/ai-config/ai-chat-handler.test.ts src/features/workstation/agent-invocation-recorder.test.ts`
Run: `node --test tests/html-personal-workbench-behavior.test.mjs`
Expected: cross-tenant ID returns not-found, restricted calls return forbidden, and no formal seed is present.

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/authorize-agent-invocation.ts src/features/agents/authorize-agent-invocation.test.ts src/features/ai-config/ai-chat-handler.ts src/features/ai-config/ai-chat-handler.test.ts src/features/workstation/agent-invocation-recorder.ts src/features/workstation/agent-invocation-recorder.test.ts quantxy-ai-workbench-fused.html tests/html-personal-workbench-behavior.test.mjs
git commit -m "security: enforce Agent invocation permissions"
```

### Task 6: Establish server-derived module capabilities and direct-route guards

**Files:**
- Create: `src/features/commercial/module-capabilities.ts`
- Create: `src/features/commercial/module-capabilities.test.ts`
- Create: `src/features/auth/server-route-access.ts`
- Create: `src/features/auth/server-route-access.test.ts`
- Modify: `src/app/(workspace)/layout.tsx`
- Modify: `src/config/navigation.ts`
- Modify: `src/features/operations/role-access.ts`
- Modify: `src/middleware.ts`

**Interfaces:**
- Produces: `getModuleCapabilities(session): Readonly<Record<CommercialModule, boolean>>`.
- Produces: `assertServerRouteAccess(session, pathname): void`.

- [ ] **Step 1: Write failing route and hidden-scope tests**

```ts
expect(getModuleCapabilities(employeeSession).attendance).toBe(false);
expect(getModuleCapabilities(employeeSession).leave).toBe(false);
expect(() => assertServerRouteAccess(employeeSession, "/settings")).toThrow("route_forbidden");
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/commercial/module-capabilities.test.ts src/features/auth/server-route-access.test.ts src/features/operations/role-access.test.ts`
Expected: capability and server guard modules do not exist.

- [ ] **Step 3: Implement one route/capability registry**

Navigation, middleware, server layout, and quick-create consumers use the same registry. Remove leave/attendance entries and route access. Keep database migrations intact.

- [ ] **Step 4: Verify GREEN and full phase gate**

Run: `npx vitest run src/features/commercial src/features/auth src/features/ai-config src/features/workstation src/features/approvals`
Run: `npm run typecheck`
Run: `npm run lint`
Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/commercial/module-capabilities.ts src/features/commercial/module-capabilities.test.ts src/features/auth/server-route-access.ts src/features/auth/server-route-access.test.ts 'src/app/(workspace)/layout.tsx' src/config/navigation.ts src/features/operations/role-access.ts src/middleware.ts
git commit -m "feat: centralize commercial module access"
```

## Completed Task Appendix (authoritative execution status)

Tasks 1-6 and every checklist step in those tasks are complete and independently reviewed at implementation HEAD `5467c97`. Their historical unchecked boxes are retained only as the original implementation record; they are not an execution queue and must not be rerun or rewritten. This appendix is the authoritative completion marker for Plan01.

Plan01 completion does **not** open Internal or Customer Production release gates. Plan02 owns shared environment/DB phase commands; Plan10 owns their consumption/verification plus migration safety, security/performance/recovery evidence, Staging canary and explicit-authorized retirement/release decisions.
