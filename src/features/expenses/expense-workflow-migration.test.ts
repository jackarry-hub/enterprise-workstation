import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(),
  "supabase/migrations/202608280008_expense_workflow_commands.sql"), "utf8");
const pgTap = readFileSync(resolve(process.cwd(), "supabase/tests/expense_workflow.sql"), "utf8");
const concurrencyPgTap = readFileSync(resolve(process.cwd(),
  "supabase/tests/expense_workflow_concurrency.sql"), "utf8");

describe("commercial expense workflow migration", () => {
  it("replaces direct writes with tenant-safe transactional commands", () => {
    expect(migration).toContain("create or replace function public.create_current_expense");
    expect(migration).toContain("create or replace function public.update_current_expense");
    expect(migration).toContain("create or replace function public.submit_current_expense");
    expect(migration).toContain("create or replace function public.mark_current_expense_paid");
    expect(migration).toContain("create or replace function public.cancel_current_expense");
    expect(migration).toContain("revoke all on table public.expense_reports from public,anon,authenticated,service_role");
    expect(migration).not.toContain("p_requester_employee_id");
  });

  it("binds verified receipts and approvals to the exact tenant and organization", () => {
    expect(migration).toContain("create table public.expense_receipts");
    expect(migration).toContain("files.verified_at is not null");
    expect(migration).toContain("expense_reports_exact_approval_fkey");
    expect(migration).toContain("expense_reports_exact_project_fkey");
    expect(migration).toContain("expense_receipts_exact_file_fkey");
    expect(migration).toContain("expense_workflow_backfill_preflight");
  });

  it("owns state changes, optimistic locking, idempotency and audit in PostgreSQL", () => {
    expect(migration).toContain("expense_command_idempotency");
    expect(migration).toContain("expense.version<>expected_version");
    expect(migration).toContain("submit_approval_for_command_identity");
    expect(migration).toContain("left join public.projects project on project.tenant_id=v_expense.tenant_id");
    expect(migration).not.toContain("project.id=v_expense.project_id on true");
    expect(migration).toContain("current_approval_command_identity('approval.submit')");
    expect(migration).toContain("from public,anon,authenticated,service_role");
    expect(migration).toContain("is_valid_expense_approval_evidence");
    expect(migration).toContain("'expense.paid'");
    expect(migration).toContain("expense_reports_reject_completed_mutation");
  });

  it("keeps the expense pgTAP plan synchronized with executable assertions", () => {
    const planned = Number(/select plan\((\d+)\)/.exec(pgTap)?.[1]);
    const assertions = [...pgTap.matchAll(/^select\s+(?:ok|is|isnt|throws_ok|lives_ok|cmp_ok|like|unlike|pass|fail)\s*\(/gm)];
    expect(planned).toBeGreaterThanOrEqual(35);
    expect(assertions).toHaveLength(planned);
  });

  it("exercises real same-key and approval-cancellation lock races", () => {
    const planned = Number(/select plan\((\d+)\)/.exec(concurrencyPgTap)?.[1]);
    const assertions = [...concurrencyPgTap.matchAll(
      /^select\s+(?:ok|is|isnt|throws_ok|lives_ok|cmp_ok|like|unlike|pass|fail)\s*\(/gm,
    )];
    expect(concurrencyPgTap).toContain("dblink_send_query");
    expect(concurrencyPgTap).toContain("cancel_current_expense");
    expect(concurrencyPgTap).toContain("act_on_current_approval");
    expect(planned).toBe(6);
    expect(assertions).toHaveLength(planned);
  });
});
