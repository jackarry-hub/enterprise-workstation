# QuantXY AI Assistant and Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver persistent AI conversations and a versioned, explainable scheduling workflow with audited human overrides and atomic task dispatch.

**Architecture:** AI provider calls are server-only and use shared database-backed rate limits and durable invocation state. Conversations, scheduling goals, plan versions, assignments, overrides, and dispatch references are stored in PostgreSQL.

**Tech Stack:** Next.js, TypeScript, Supabase PostgreSQL, DeepSeek provider adapter, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Depends on Plans 01-06.
- AI secrets and system prompts never reach browser storage.
- Rule fallback is explicitly labeled and never presented as model output.
- Missing cost data is rendered as unconfigured, not zero.
- Every model attempt reaches a durable terminal invocation state.

---

### Task 1: Add shared AI rate limits and durable invocation completion

**Files:**
- Create: `supabase/migrations/202608260028_ai_runtime_limits.sql`
- Create: `supabase/tests/ai_runtime.sql`
- Create: `src/features/ai-runtime/rate-limit-store.ts`
- Create: `src/features/ai-runtime/rate-limit-store.test.ts`
- Modify: `src/features/ai-config/ai-chat-handler.ts`
- Modify: `src/features/ai-config/ai-chat-handler.test.ts`

**Interfaces:**
- Produces RPC `consume_current_ai_rate_limit(operation text, window_seconds integer, limit_count integer, request_id uuid)`.
- Produces invocation states queued, running, succeeded, failed, timed_out, rate_limited.

- [ ] **Step 1: Write failing multi-instance, timeout, and error-finalization tests**

```ts
expect(await consumeAcrossTwoHandlerInstances(31)).toMatchObject({ allowed: false });
expect(await invocationAfterTimeout()).toMatchObject({ status: "timed_out" });
expect(await invocationAfterProvider401()).toMatchObject({ status: "failed", errorCode: "ai_provider_unauthorized" });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/ai-runtime/rate-limit-store.test.ts src/features/ai-config/ai-chat-handler.test.ts`
Expected: rate-limit module is absent and current limiter is process-local.

- [ ] **Step 3: Implement DB-backed limiter and invocation finally path**

Create invocation before provider call, atomically consume tenant/user/operation quota, and update terminal state in `finally` for all provider and parsing failures.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/ai-runtime/rate-limit-store.test.ts src/features/ai-config/ai-chat-handler.test.ts`
Run: `npm run db:test`
Expected: shared quota, timeout, provider error and success states pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260028_ai_runtime_limits.sql supabase/tests/ai_runtime.sql src/features/ai-runtime/rate-limit-store.ts src/features/ai-runtime/rate-limit-store.test.ts src/features/ai-config/ai-chat-handler.ts src/features/ai-config/ai-chat-handler.test.ts
git commit -m "feat: add durable AI runtime controls"
```

### Task 2: Persist AI assistant conversations and messages

**Files:**
- Create: `supabase/migrations/202608260029_ai_conversations.sql`
- Modify: `supabase/tests/ai_runtime.sql`
- Create: `src/features/ai-assistant/conversation-handler.ts`
- Create: `src/features/ai-assistant/conversation-handler.test.ts`
- Create: `src/app/api/workstation/ai/conversations/route.ts`
- Create: `src/app/api/workstation/ai/conversations/[conversationId]/messages/route.ts`
- Create: `src/app/api/workstation/ai/conversations/[conversationId]/route.ts`

**Interfaces:**
- Produces tables `ai_conversations`, `ai_messages`, `ai_tool_calls`.
- Conversation list and message commands are current-user scoped; archive uses version comparison.

- [ ] **Step 1: Write failing owner, cross-tenant, retry, and message-order tests**

```ts
expect((await listConversations(otherEmployee)).body.items).toHaveLength(0);
expect((await sendSameMessageKeyTwice()).messageIds).toHaveLength(1);
expect(messages.map((message) => message.sequence)).toEqual([1, 2]);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/ai-assistant/conversation-handler.test.ts`
Expected: conversation module is absent.

- [ ] **Step 3: Implement conversation/message transactions**

Persist the user message before model execution, create the assistant message from the terminal invocation, store safe tool metadata, and return stable public IDs.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/ai-assistant/conversation-handler.test.ts`
Run: `npm run db:test`
Expected: self-only access, idempotent send, stable ordering and archived conversation behavior pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260029_ai_conversations.sql supabase/tests/ai_runtime.sql src/features/ai-assistant/conversation-handler.ts src/features/ai-assistant/conversation-handler.test.ts src/app/api/workstation/ai/conversations/route.ts src/app/api/workstation/ai/conversations/[conversationId]/messages/route.ts src/app/api/workstation/ai/conversations/[conversationId]/route.ts
git commit -m "feat: persist AI assistant conversations"
```

### Task 3: Add versioned scheduling goals and plans

**Files:**
- Create: `supabase/migrations/202608260030_ai_scheduling.sql`
- Create: `supabase/tests/ai_scheduling.sql`
- Create: `src/features/ai-scheduler/scheduling-handler.ts`
- Create: `src/features/ai-scheduler/scheduling-handler.test.ts`
- Create: `src/app/api/workstation/scheduling/goals/route.ts`
- Create: `src/app/api/workstation/scheduling/goals/[goalId]/plans/route.ts`

**Interfaces:**
- Produces tables `scheduling_goals`, `scheduling_plan_versions`, `scheduling_assignments`, `scheduling_overrides`.
- Plan result records source `model` or `rules`, evidence entity IDs, and nullable cost fields.

- [ ] **Step 1: Write failing source-label, evidence, and missing-cost tests**

```ts
expect(rulePlan.source).toBe("rules");
expect(modelPlan.assignments[0].evidence.taskIds).toEqual([knownTaskId]);
expect(planWithMissingCost.summary.cost).toBeNull();
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/ai-scheduler/scheduling-handler.test.ts`
Expected: scheduling persistence module is absent.

- [ ] **Step 3: Implement goal creation and plan generation**

Load authorized real project/member/skill/task evidence, persist the goal before generation, store immutable plan versions, label source, and keep cost/risk nullable unless calculated from traceable inputs.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/ai-scheduler/scheduling-handler.test.ts`
Run: `npm run db:test`
Expected: model/rules labels, evidence IDs, null cost and tenant isolation pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260030_ai_scheduling.sql supabase/tests/ai_scheduling.sql src/features/ai-scheduler/scheduling-handler.ts src/features/ai-scheduler/scheduling-handler.test.ts src/app/api/workstation/scheduling/goals/route.ts src/app/api/workstation/scheduling/goals/[goalId]/plans/route.ts
git commit -m "feat: persist explainable AI scheduling plans"
```

### Task 4: Audit human overrides and dispatch a locked plan atomically

**Files:**
- Create: `supabase/migrations/202608260031_ai_scheduling_dispatch.sql`
- Modify: `supabase/tests/ai_scheduling.sql`
- Create: `src/app/api/workstation/scheduling/plans/[planId]/overrides/route.ts`
- Create: `src/app/api/workstation/scheduling/plans/[planId]/dispatch/route.ts`
- Modify: `src/features/ai-scheduler/scheduling-handler.ts`
- Modify: `src/features/ai-scheduler/scheduling-handler.test.ts`

**Interfaces:**
- Override command requires assignment ID, replacement member ID, reason, expected plan version.
- Dispatch locks plan and calls the atomic task batch RPC from Plan 03.

- [ ] **Step 1: Write failing reason, concurrency, and duplicate-dispatch tests**

```ts
expect((await overrideWithoutReason()).status).toBe(400);
expect((await staleOverride()).status).toBe(409);
expect((await dispatchSamePlanTwice()).taskIds).toEqual(firstDispatch.taskIds);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/ai-scheduler/scheduling-handler.test.ts`
Expected: overrides are currently browser-local and dispatch is not tied to a persisted plan.

- [ ] **Step 3: Implement override and locked dispatch RPCs**

Append original/replacement/reason/actor/time to overrides, create a new plan version, lock the approved version on dispatch, and record returned task IDs and notification outbox IDs.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/ai-scheduler/scheduling-handler.test.ts`
Run: `npm run db:test`
Expected: reason required, stale version rejected, dispatch idempotent, all tasks reference the plan version.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260031_ai_scheduling_dispatch.sql supabase/tests/ai_scheduling.sql src/app/api/workstation/scheduling/plans/[planId]/overrides/route.ts src/app/api/workstation/scheduling/plans/[planId]/dispatch/route.ts src/features/ai-scheduler/scheduling-handler.ts src/features/ai-scheduler/scheduling-handler.test.ts
git commit -m "feat: audit scheduling overrides and dispatch"
```

### Task 5: Build real responsive AI assistant and scheduler pages

**Files:**
- Create: `src/app/(workspace)/assistant/page.tsx`
- Create: `src/app/(workspace)/scheduler/page.tsx`
- Create: `src/features/ai-assistant/assistant-workspace.tsx`
- Create: `src/features/ai-assistant/assistant-workspace.test.tsx`
- Create: `src/features/ai-scheduler/scheduler-workspace.tsx`
- Create: `src/features/ai-scheduler/scheduler-workspace.test.tsx`
- Create: `tests/e2e/ai-assistant.spec.ts`
- Create: `tests/e2e/ai-scheduler.spec.ts`

**Interfaces:**
- Consumes Tasks 1-4 APIs.
- Produces persisted conversation and scheduling UIs for desktop and mobile PWA.

- [ ] **Step 1: Write failing history, rule-label, and override-refresh tests**

```tsx
expect(screen.getByText(persistedConversation.title)).toBeInTheDocument();
expect(screen.getByText("规则方案")).toBeInTheDocument();
expect(screen.getByText("人工改派：资源冲突")).toBeInTheDocument();
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/ai-assistant/assistant-workspace.test.tsx src/features/ai-scheduler/scheduler-workspace.test.tsx`
Expected: Next workspaces do not exist.

- [ ] **Step 3: Implement server-backed responsive workspaces**

Mobile conversations use a full-screen thread with safe back navigation. Scheduler uses goal -> plan -> override -> confirmation steps with sticky primary action and explicit model/rules badges.

- [ ] **Step 4: Verify GREEN and real browser persistence**

Run: `npx vitest run src/features/ai-assistant src/features/ai-scheduler`
Run: `npx playwright test tests/e2e/ai-assistant.spec.ts tests/e2e/ai-scheduler.spec.ts --project=chrome`
Expected: history and overrides survive refresh; locked dispatch creates real tasks once.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(workspace)/assistant/page.tsx' 'src/app/(workspace)/scheduler/page.tsx' src/features/ai-assistant src/features/ai-scheduler tests/e2e/ai-assistant.spec.ts tests/e2e/ai-scheduler.spec.ts
git commit -m "feat: deliver AI assistant and scheduler workspaces"
```

### Task 6: Add governed queue operations, budgets and pre-execution human confirmation

**Files:**
- Create: `supabase/migrations/202608260044_ai_queue_governance.sql`
- Modify: `supabase/tests/ai_runtime.sql`
- Create: `src/features/ai-runtime/queue-handler.ts`
- Create: `src/features/ai-runtime/queue-handler.test.ts`
- Create: `src/features/ai-runtime/human-confirmation.ts`
- Create: `src/features/ai-runtime/human-confirmation.test.ts`
- Create: `src/features/ai-runtime/high-risk-tool-dispatcher.ts`
- Create: `src/features/ai-runtime/high-risk-tool-dispatcher.test.ts`
- Create: `src/features/ai-runtime/tools/send-message.ts`
- Create: `src/features/ai-runtime/tools/modify-business-data.ts`
- Create: `src/features/ai-runtime/tools/create-approval.ts`
- Create: `src/features/ai-runtime/tools/publish-content.ts`
- Create: `src/features/ai-runtime/tools/modify-permission.ts`
- Create: `src/features/ai-runtime/tools/delete-material.ts`
- Create: `src/features/ai-runtime/tools/export-data.ts`
- Create: `src/features/ai-runtime/tools/create-payment-record.ts`
- Create: `src/app/api/workstation/ai/runs/[runId]/confirm/route.ts`

**Interfaces:**
- Produces tenant/user/department quota, queue, schedule, lock, cancel, retry and dead-letter controls with terminal retention metadata.
- Produces central `dispatchHighRiskTool({ actorId, tenantId, resourceId, action, payloadHash, confirmationId })`, with adapters for `send_message`, `modify_business_data`, `create_approval`, `publish_content`, `modify_permission`, `delete_material`, `export_data`, `create_payment_record`.
- Produces one-time `requireHumanConfirmation({ actorId, tenantId, resourceId, action, payloadHash })`; confirmation is fresh and bound to the exact actor/tenant/resource/action/payload, and writes both confirmation and execution audits.

- [ ] **Step 1: Write failing queue, timeout, fallback, budget, retention/evaluation/takeover and confirmation tests**

```ts
expect(await queueAtConcurrencyLimit()).toMatchObject({ status: "queued" });
expect(await executeWithoutConfirmation("export_data")).toMatchObject({ code: "human_confirmation_required" });
expect(await exhaustedDepartmentBudget()).toMatchObject({ status: "rate_limited" });
expect(await replayConfirmation("export_data")).toMatchObject({ code: "human_confirmation_replayed" });
expect(await useExpiredConfirmation("create_payment_record")).toMatchObject({ code: "human_confirmation_expired" });
expect(await confirmForTenantAThenExecuteTenantB()).toMatchObject({ code: "human_confirmation_mismatch" });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/ai-runtime`
Run: `npm run db:test`
Expected: durable queue, quotas, DLQ, evaluation/takeover and universal high-risk confirmation are incomplete.

- [ ] **Step 3: Implement bounded runtime governance**

Persist queued/running/terminal state, scheduled time, idempotency, timeout/cancel/retry/DLQ, worker lock and model fallback. Enforce token/cost/concurrency budgets per tenant, department and user; retain conversations/runs by policy, persist evaluation cases and route failures to a human takeover queue. Route every high-risk action through the central dispatcher; it validates a fresh one-time bound confirmation, rejects replay/expiry/mismatch, invokes the matching server adapter and atomically records confirmation plus execution audit. No client flag or direct adapter call bypasses it.

- [ ] **Step 4: Verify GREEN and load boundary**

Run: `npx vitest run src/features/ai-runtime src/features/ai-assistant src/features/ai-scheduler`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/ai-assistant.spec.ts tests/e2e/ai-scheduler.spec.ts --project=chrome`
Expected: ten concurrent AI/Agent jobs expose queue status, non-AI workflows remain available during AI failure, and each of the eight protected adapters rejects missing/replayed/expired/cross-tenant confirmations while recording confirmation/execution audit.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260044_ai_queue_governance.sql supabase/tests/ai_runtime.sql src/features/ai-runtime src/app/api/workstation/ai tests/e2e/ai-assistant.spec.ts tests/e2e/ai-scheduler.spec.ts
git commit -m "feat: govern AI queue and high-risk confirmation"
```
