// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608040005_approvals.sql");

describe("approvals migration", () => {
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8").toLowerCase() : "";

  it.each(["approvals", "approval_steps", "approval_actions"])("creates and protects %s", (table) => {
    expect(migration).toContain(`create table public.${table}`);
    expect(migration).toContain(`alter table public.${table} enable row level security`);
    expect(migration).toContain(`alter table public.${table} force row level security`);
  });

  it("keeps fixed V0.9 types and statuses explicit", () => {
    expect(migration).toContain("check (approval_type in ('leave', 'reimbursement', 'purchase', 'contract'))");
    expect(migration).toContain("check (status in ('draft', 'pending', 'approved', 'rejected'))");
    expect(migration).toContain("check (action_type in ('submit', 'approve', 'reject', 'comment'))");
  });

  it("indexes organization queues and immutable history", () => {
    expect(migration).toContain("approvals_organization_status_submitted_idx");
    expect(migration).toContain("approval_steps_approval_order_idx");
    expect(migration).toContain("approval_actions_approval_created_idx");
    expect(migration).not.toContain("approval_actions_manager_update");
  });

  it("allows organization reads and managed writes without delete policies", () => {
    expect(migration).toContain("approvals_member_select");
    expect(migration).toContain("approvals_manager_insert");
    expect(migration).toContain("approvals_manager_update");
    expect(migration).toContain("array['owner', 'admin', 'hr', 'finance']");
    expect(migration).not.toContain("approvals_manager_delete");
  });
});
