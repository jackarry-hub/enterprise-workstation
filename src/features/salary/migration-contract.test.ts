// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608040006_salary.sql");

describe("salary migration", () => {
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8").toLowerCase() : "";

  it("creates one stable salary table with monthly amounts", () => {
    expect(migration).toContain("create table public.salary");
    expect(migration).toContain("payroll_month date not null");
    expect(migration).toContain("base_salary numeric(14,2) not null");
    expect(migration).toContain("net_salary numeric(14,2) not null");
    expect(migration).toContain("check (status in ('draft', 'processing', 'paid'))");
  });

  it("prevents duplicate active monthly payslips and supports employee history", () => {
    expect(migration).toContain("salary_organization_employee_month_idx");
    expect(migration).toContain("salary_organization_month_status_idx");
    expect(migration).toContain("salary_employee_month_idx");
  });

  it("protects salary visibility and managed writes", () => {
    expect(migration).toContain("alter table public.salary enable row level security");
    expect(migration).toContain("alter table public.salary force row level security");
    expect(migration).toContain("salary_self_or_manager_select");
    expect(migration).toContain("salary_manager_insert");
    expect(migration).toContain("salary_manager_update");
    expect(migration).toContain("array['owner', 'admin', 'hr', 'finance']");
    expect(migration).not.toContain("salary_manager_delete");
  });
});
