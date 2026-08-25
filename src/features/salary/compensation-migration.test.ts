// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608250001_compensation_bonus_expenses.sql");

describe("compensation, bonus pool and reimbursement migration", () => {
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8").toLowerCase() : "";

  it("adds employee grade fields and configurable department grade salary policies", () => {
    expect(migration).toContain("alter table public.employee_profiles");
    expect(migration).toContain("salary_grade_code");
    expect(migration).toContain("job_level");
    expect(migration).toContain("'salarygradecode', profile.salary_grade_code");
    expect(migration).toContain("'joblevel', profile.job_level");
    expect(migration).toContain("create table public.salary_grade_policies");
    expect(migration).toContain("department_id bigint");
    expect(migration).toContain("base_salary numeric(14,2)");
    expect(migration).toContain("salary_band_min numeric(14,2)");
    expect(migration).toContain("salary_band_max numeric(14,2)");
  });

  it("tracks project bonus pools and immutable task bonus allocations", () => {
    expect(migration).toContain("create table public.project_bonus_pools");
    expect(migration).toContain("create table public.task_bonus_allocations");
    expect(migration).toContain("unique (tenant_id, organization_id, id)");
    expect(migration).toContain("difficulty_score smallint");
    expect(migration).toContain("quality_score smallint");
    expect(migration).toContain("efficiency_score smallint");
    expect(migration).toContain("manual_adjustment_reason text");
  });

  it("creates a first-class reimbursement ledger linked to approval workflow", () => {
    expect(migration).toContain("create table public.expense_reports");
    expect(migration).toContain("approval_id bigint");
    expect(migration).toContain("amount numeric(14,2)");
    expect(migration).toContain("receipt_file_ids text[]");
    expect(migration).toContain("status text not null default 'draft'");
  });

  it("protects finance tables with RLS, indexes and no delete policy", () => {
    for (const table of [
      "salary_grade_policies",
      "project_bonus_pools",
      "task_bonus_allocations",
      "expense_reports",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`alter table public.${table} force row level security`);
    }
    expect(migration).toContain("salary_grade_policies_lookup_idx");
    expect(migration).toContain("project_bonus_pools_project_idx");
    expect(migration).toContain("task_bonus_allocations_employee_month_idx");
    expect(migration).toContain("expense_reports_requester_status_idx");
    expect(migration).not.toContain("_delete");
  });
});
