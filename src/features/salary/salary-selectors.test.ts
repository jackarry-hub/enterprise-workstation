import { describe, expect, it } from "vitest";

import { salaryMockResult } from "@/features/salary/salary-mock-data";
import { filterSalaryRecords, getSalaryDetail } from "@/features/salary/salary-selectors";

describe("salary selectors", () => {
  it("provides the approved payroll summary", () => {
    expect(salaryMockResult.data.stats).toEqual({
      totalSalary: 202700,
      employeeCount: 10,
      averageSalary: 20270,
    });
  });

  it("includes the CEO's own payslip in the company payroll data", () => {
    expect(salaryMockResult.data.records).toContainEqual(expect.objectContaining({
      employee: expect.objectContaining({ displayName: "林远", jobTitle: "CEO" }),
      baseSalary: 25000,
      bonus: 8000,
      deductions: 2500,
      netSalary: 30500,
    }));
  });

  it("filters salary records by employee, department, month, and status", () => {
    const first = salaryMockResult.data.records[0];
    const rows = filterSalaryRecords(salaryMockResult.data.records, {
      query: first.employee.employeeNo,
      departmentId: first.department.id,
      month: "2026-08",
      status: first.status,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
  });

  it("resolves a payslip with composition and history", () => {
    const record = getSalaryDetail("91000000-0000-4000-8000-000000000001", salaryMockResult);
    expect(record?.breakdown.length).toBeGreaterThanOrEqual(4);
    expect(record?.history).toHaveLength(6);
  });
});
