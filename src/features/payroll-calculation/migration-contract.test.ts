// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202608210004_payroll_calculation.sql",
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("payroll calculation migration", () => {
  it("creates a versioned organization payroll policy", () => {
    expect(sql).toContain("create table public.payroll_policies");
    expect(sql).toContain("effective_month date not null");
    expect(sql).toContain("status in ('draft', 'active', 'retired')");
    expect(sql).toContain("pension_employee_rate numeric(9,6)");
    expect(sql).toContain("medical_employee_fixed_amount numeric(14,2)");
    expect(sql).toContain("payroll_policies_one_active_month_idx");
    expect(sql).toContain(
      "status in ('active', 'retired') and activated_by_member_id is not null",
    );
  });

  it("extends salary with inputs, detailed outputs, and immutable snapshots", () => {
    for (const column of [
      "policy_id",
      "policy_snapshot",
      "calculation_snapshot",
      "other_income",
      "gross_salary",
      "social_base",
      "housing_fund_base",
      "pension_employee",
      "medical_employee",
      "unemployment_employee",
      "housing_fund_employee",
      "tax_exempt_income",
      "special_additional_deduction",
      "other_statutory_deduction",
      "tax_relief",
      "employment_months_ytd",
      "opening_cumulative_income",
      "opening_cumulative_tax_withheld",
      "cumulative_taxable_income",
      "manual_adjustment_reason",
      "calculation_version",
    ]) {
      expect(sql, `missing salary column ${column}`).toContain(
        `add column if not exists ${column}`,
      );
    }
    expect(sql).toContain("calculated salary requires complete snapshots");
  });

  it("checks salary.manage through the real role-permission matrix", () => {
    expect(sql).toContain("create or replace function public.has_organization_permission");
    expect(sql).toContain("permission.code = target_permission_code");
    expect(sql).toContain("'salary.manage'");
  });

  it("protects policy rows with forced RLS and least privilege grants", () => {
    expect(sql).toContain("alter table public.payroll_policies enable row level security");
    expect(sql).toContain("alter table public.payroll_policies force row level security");
    expect(sql).toContain("payroll_policies_manager_select");
    expect(sql).not.toMatch(/grant\s+all\s+on\s+public\.payroll_policies/i);
  });

  it("saves policy activation and salary confirmation atomically", () => {
    expect(sql).toContain("create or replace function public.save_payroll_policy_v1");
    expect(sql).toContain("create or replace function public.save_salary_calculation_v1");
    expect(sql.match(/pg_advisory_xact_lock/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("confirmed payroll is immutable");
    expect(sql).toContain("status in ('processing', 'paid')");
    expect(sql).toContain("policy.effective_month <= v_payroll_month");
    expect(sql).toContain("policy_snapshot");
    expect(sql).toContain("calculation_snapshot");
  });

  it("keeps RPC execution authenticated-only and records payroll audit actions", () => {
    expect(sql).toMatch(
      /revoke all on function public\.save_payroll_policy_v1\(jsonb\)[\s\S]*from public, anon/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.save_salary_calculation_v1\(jsonb\)[\s\S]*from public, anon/i,
    );
    expect(sql).toContain("'payroll_policy.activated'");
    expect(sql).toContain("'payroll.calculated'");
    expect(sql).toContain("'payroll.confirmed'");
  });
});
