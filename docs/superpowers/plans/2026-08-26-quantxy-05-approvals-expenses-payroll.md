# QuantXY Approvals, Expenses, and Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver participant-safe approvals, end-to-end expense reimbursement, and privacy-safe payroll administration.

**Architecture:** Approval and expense state machines run in PostgreSQL transactions and append immutable actions/audit. Payroll owns governed batches, immutable snapshots and scoped publication/read/export rather than a full salary-calculation engine, while replacing all fixture UI with scoped server data.

**Tech Stack:** Next.js, TypeScript, Supabase PostgreSQL/Storage, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Depends on Plans 01-04.
- Approval actions are never direct table inserts.
- Expense attachments use Plan 03 verified files.
- Confirmed payroll and completed approval actions are immutable.
- Ordinary employees never receive another employee's band or payroll row.

---

### Task 1: Add approval templates and transactional submission

**Files:**
- Create: `supabase/migrations/202608260016_approval_workflow_commands.sql`
- Create: `supabase/tests/approval_workflow.sql`
- Create: `src/features/approvals/approval-command-handler.ts`
- Create: `src/features/approvals/approval-command-handler.test.ts`
- Create: `src/app/api/workstation/approvals/route.ts`

**Interfaces:**
- Produces table `approval_templates` with versioned step definitions.
- Produces RPC `submit_current_approval(template_public_id uuid, form_data jsonb, idempotency_key uuid, request_id uuid)`.

- [ ] **Step 1: Write failing template, participant, and idempotency tests**

```ts
expect((await submitApproval(employeeSession, validForm)).status).toBe(201);
expect((await submitApproval(employeeSession, invalidForm)).status).toBe(422);
expect((await repeatSubmission(sameKey)).approvalId).toBe(firstApprovalId);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/approvals/approval-command-handler.test.ts`
Expected: command handler and template model are absent.

- [ ] **Step 3: Implement versioned templates and submission RPC**

Validate form fields against the stored template version, resolve approvers from server-owned rules, and atomically create approval, steps, first pending action state, idempotency result and audit.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/approvals/approval-command-handler.test.ts`
Run: `npm run db:test`
Expected: valid submission persists, invalid form fails, unrelated employee cannot read it, repeated key returns one instance.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260016_approval_workflow_commands.sql supabase/tests/approval_workflow.sql src/features/approvals/approval-command-handler.ts src/features/approvals/approval-command-handler.test.ts src/app/api/workstation/approvals/route.ts
git commit -m "feat: add transactional approval submission"
```

### Task 2: Add secure approval decisions and cancellation

**Files:**
- Create: `supabase/migrations/202608260017_approval_action_commands.sql`
- Modify: `supabase/tests/approval_workflow.sql`
- Create: `src/app/api/workstation/approvals/[approvalId]/actions/route.ts`
- Modify: `src/features/approvals/approval-command-handler.ts`
- Modify: `src/features/approvals/approval-command-handler.test.ts`

**Interfaces:**
- Produces RPC `act_on_current_approval(approval_public_id uuid, command text, expected_version integer, comment text, request_id uuid)`.
- Commands: approve, reject, return, cancel.

- [ ] **Step 1: Write failing current-approver, actor-spoof, and concurrency tests**

```ts
expect((await actAs(unrelatedEmployee, "approve")).status).toBe(403);
expect(savedAction.actorId).toBe(currentApprover.member.publicId);
expect((await concurrentApprovalSecondWriter()).status).toBe(409);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/approvals/approval-command-handler.test.ts`
Expected: action route/RPC does not exist.

- [ ] **Step 3: Implement the approval state machine**

Lock the approval row, verify current pending step and approver, ignore actor values from input, transition step/approval/action/audit atomically, and advance to the next step only after approval.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/approvals/approval-command-handler.test.ts`
Run: `npm run db:test`
Expected: only current approver acts; version conflict returns 409; action and audit are immutable.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260017_approval_action_commands.sql supabase/tests/approval_workflow.sql src/app/api/workstation/approvals/[approvalId]/actions/route.ts src/features/approvals/approval-command-handler.ts src/features/approvals/approval-command-handler.test.ts
git commit -m "feat: add secure approval decisions"
```

### Task 3: Complete expense submission, approval, and payment

**Files:**
- Create: `supabase/migrations/202608260018_expense_workflow_commands.sql`
- Create: `supabase/tests/expense_workflow.sql`
- Create: `src/features/expenses/expense-command-handler.ts`
- Create: `src/features/expenses/expense-command-handler.test.ts`
- Create: `src/app/api/workstation/expenses/route.ts`
- Create: `src/app/api/workstation/expenses/[expenseId]/submit/route.ts`
- Create: `src/app/api/workstation/expenses/[expenseId]/payment/route.ts`

**Interfaces:**
- Produces commands create draft, update draft, submit, mark paid, cancel.
- Ownership fields are immutable after create; submission links to an approval instance.

- [ ] **Step 1: Write failing ownership, decimal, attachment, and payment tests**

```ts
expect((await updateExpense({ requesterId: otherMember })).status).toBe(422);
expect((await submitExpense({ amount: "12.345" })).status).toBe(400);
expect((await markPaid(employeeSession)).status).toBe(403);
expect((await markPaid(financeSession)).status).toBe(200);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/expenses/expense-command-handler.test.ts`
Expected: expense command module is absent.

- [ ] **Step 3: Implement expense RPCs and approval linkage**

Use decimal amount validation, verified file relations, immutable requester/project fields, a transactional approval submission on submit, and finance-only payment metadata/audit.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/expenses/expense-command-handler.test.ts`
Run: `npm run db:test`
Expected: ownership rewrite fails, unverified files fail, approval link exists, finance payment is audited.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260018_expense_workflow_commands.sql supabase/tests/expense_workflow.sql src/features/expenses/expense-command-handler.ts src/features/expenses/expense-command-handler.test.ts src/app/api/workstation/expenses/route.ts src/app/api/workstation/expenses/[expenseId]/submit/route.ts src/app/api/workstation/expenses/[expenseId]/payment/route.ts
git commit -m "feat: complete expense reimbursement workflow"
```

### Task 4: Connect approval and expense pages to real commands

**Files:**
- Modify: `src/features/approvals/approvals-workspace.tsx`
- Modify: `src/features/approvals/approval-detail-page.tsx`
- Modify: `src/features/approvals/approval-pages.test.tsx`
- Create: `src/features/expenses/expense-dialog.tsx`
- Create: `src/features/expenses/expense-page.test.tsx`
- Modify: `tests/e2e/approvals.spec.ts`
- Create: `tests/e2e/expenses.spec.ts`

**Interfaces:**
- Consumes Tasks 1-3 APIs.
- Produces current-step-only action UI and responsive expense form.

- [ ] **Step 1: Write failing server-success and refresh tests**

```tsx
await user.click(screen.getByRole("button", { name: "同意" }));
expect(api.act).toHaveBeenCalledWith(expect.objectContaining({ version: 3, command: "approve" }));
expect(screen.queryByText("审批已通过")).not.toBeInTheDocument();
```

The final assertion changes to visible only after the mocked server reload returns approved.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/approvals/approval-pages.test.tsx src/features/expenses/expense-page.test.tsx`
Expected: current page uses local setState and expense UI does not exist.

- [ ] **Step 3: Implement API-backed responsive UI**

Show action buttons only for current approver. Mobile uses full-screen form and sticky submit bar. Reload detail after a 2xx response; map 409 to refresh-required state.

- [ ] **Step 4: Verify GREEN and real browser flow**

Run: `npx vitest run src/features/approvals src/features/expenses`
Run: `npx playwright test tests/e2e/approvals.spec.ts tests/e2e/expenses.spec.ts --project=chrome`
Expected: submit -> approve -> pay survives refresh and unrelated employee cannot view it.

- [ ] **Step 5: Commit**

```bash
git add src/features/approvals src/features/expenses tests/e2e/approvals.spec.ts tests/e2e/expenses.spec.ts
git commit -m "feat: connect approvals and expenses to real workflows"
```

### Task 5: Finish payroll policy administration and real payroll pages

**Files:**
- Modify: `src/features/salary/salary-data.test.ts`
- Modify: `src/features/salary/salary-data.ts`
- Modify: `src/features/salary/payroll-workspace.tsx`
- Modify: `src/features/salary/payroll-pages.test.tsx`
- Modify: `src/app/api/workstation/payroll/policy/handler.test.ts`
- Modify: `src/app/api/workstation/payroll/policy/handler.ts`
- Create: `supabase/migrations/202608260019_payroll_policy_audit.sql`
- Modify: `supabase/tests/sensitive_rls_matrix.sql`
- Modify: `tests/e2e/payroll-calculation.spec.ts`

**Interfaces:**
- Consumes Plan 01 salary privacy/matching corrections and existing payroll calculation service.
- Produces audited draft policy save and scoped payroll list/detail repositories.

- [ ] **Step 1: Write failing draft-audit and real-page tests**

```ts
expect(savedDraftAudit.action).toBe("salary.policy.draft_saved");
expect(employeePayrollRows.every((row) => row.employeeId === employeeId)).toBe(true);
expect(financePayrollRows).toHaveLength(knownOrganizationCount);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/salary/salary-data.test.ts src/features/salary/payroll-pages.test.tsx src/app/api/workstation/payroll/policy/handler.test.ts`
Expected: draft save lacks audit and formal pages still contain fixture branches.

- [ ] **Step 3: Add draft audit and remove fixture payroll data**

Use the authenticated user-scoped repository, show employee self view or `salary.manage` organization view, and keep preview hash/confirmed immutability unchanged.

- [ ] **Step 4: Verify GREEN and real payroll E2E**

Run: `npx vitest run src/features/salary src/features/payroll-calculation src/app/api/workstation/payroll`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/payroll-calculation.spec.ts --project=chrome`
Expected: E2E uses real API/DB, employee sees self only, finance confirms an immutable run.

- [ ] **Step 5: Commit**

```bash
git add src/features/salary src/app/api/workstation/payroll supabase/migrations/202608260019_payroll_policy_audit.sql supabase/tests/sensitive_rls_matrix.sql tests/e2e/payroll-calculation.spec.ts
git commit -m "feat: complete real payroll administration"
```

### Task 6: Close the approved commercial approval, expense and payroll scope

**Files:**
- Create: `supabase/migrations/202608260037_commercial_finance_controls.sql`
- Modify: `supabase/tests/approval_workflow.sql`
- Modify: `supabase/tests/expense_workflow.sql`
- Modify: `supabase/tests/sensitive_rls_matrix.sql`
- Modify: `src/features/approvals/approval-command-handler.ts`
- Modify: `src/features/expenses/expense-command-handler.ts`
- Create: `src/features/salary/payroll-batch-handler.ts`
- Create: `src/features/salary/payroll-batch-handler.test.ts`
- Create: `src/features/approvals/approval-exception-worker.ts`
- Create: `src/features/approvals/approval-exception-worker.test.ts`
- Create: `src/features/expenses/finance-review-handler.ts`
- Create: `src/features/expenses/finance-review-handler.test.ts`
- Create: `src/app/api/workstation/approvals/[approvalId]/transfer/route.ts`
- Create: `src/app/api/workstation/approvals/[approvalId]/withdraw/route.ts`
- Create: `src/app/api/workstation/expenses/[expenseId]/finance-review/route.ts`
- Create: `src/app/api/workstation/payroll/batches/[batchId]/lock/route.ts`
- Create: `src/app/api/workstation/payroll/batches/[batchId]/publish/route.ts`
- Create: `src/app/api/workstation/payroll/batches/[batchId]/unpublish/route.ts`
- Create: `src/app/api/workstation/payroll/batches/[batchId]/export/route.ts`
- Create: `src/features/approvals/approval-exception-panel.tsx`
- Create: `src/features/expenses/finance-review-panel.tsx`
- Create: `src/features/salary/payroll-batch-panel.tsx`

**Interfaces:**
- Produces migration/RPCs `transfer_current_approval`, `withdraw_current_approval`, `expire_pending_approvals`, `reassign_departed_approver`, `finance_review_current_expense`, `mark_current_expense_paid`, `lock_current_payroll_batch`, `publish_current_payroll_batch`, `unpublish_current_payroll_batch` and `export_current_payroll_batch`.
- Produces immutable template versions/submission snapshots/basic conditional branches and payroll `lock|publish|unpublish` UI, worker and APIs with self-only employee read, encrypted/watermarked export and audit.

- [ ] **Step 1: Write failing snapshot, branch, transfer/withdraw/timeout and payroll lifecycle tests**

```ts
expect(await submitAgainstEditedTemplate()).toMatchObject({ templateVersion: 2, snapshot: expect.any(Object) });
expect((await transferFromDepartedApprover()).status).toBe(200);
expect((await publishUnlockedBatch()).status).toBe(422);
expect(employeeExport).toContain("CONFIDENTIAL");
expect(await expireAndReassignDepartedApprover()).toMatchObject({ status: "pending", auditAction: "approval.approver_reassigned" });
expect(await financeReviewAsEmployee()).toMatchObject({ status: 403 });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/approvals src/features/expenses src/features/salary/payroll-batch-handler.test.ts`
Run: `npm run db:test`
Expected: template snapshots/edge transitions and formally controlled payroll batches are incomplete.

- [ ] **Step 3: Implement only the bounded formal workflow**

Evaluate server-owned basic conditions, snapshot template/form/approver data at submission, and transition transfer, withdrawal, timeout and departed approver cases transactionally. Expense states include draft, submitted, approved/rejected, finance-review and paid. Lock batches before publish, allow audited unpublish under policy, encrypt protected payroll data and emit watermarked authorized exports. Do not build a general visual approval designer or a full salary-calculation engine.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/approvals src/features/expenses src/features/salary`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/approvals.spec.ts tests/e2e/expenses.spec.ts tests/e2e/payroll-calculation.spec.ts --project=chrome`
Expected: snapshots are immutable, duplicate submissions have one result, employee reads self only and finance actions are fully audited.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260037_commercial_finance_controls.sql supabase/tests/approval_workflow.sql supabase/tests/expense_workflow.sql supabase/tests/sensitive_rls_matrix.sql src/features/approvals src/features/expenses src/features/salary tests/e2e/approvals.spec.ts tests/e2e/expenses.spec.ts tests/e2e/payroll-calculation.spec.ts
git commit -m "feat: complete commercial finance controls"
```
