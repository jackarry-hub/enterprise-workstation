import { describe, expect, it } from "vitest";

import { calculateMonthlyCompensation } from "@/features/salary/compensation-engine";

describe("compensation engine", () => {
  it("calculates monthly salary from the best department-grade policy and task bonus allocations", () => {
    const result = calculateMonthlyCompensation({
      payrollMonth: "2026-08-01",
      employee: {
        employeeProfileId: 11,
        departmentId: 21,
        salaryGradeCode: "P6",
        jobLevel: 6,
      },
      policies: [
        {
          id: "global-p6",
          departmentId: null,
          salaryGradeCode: "P6",
          jobLevel: 6,
          baseSalary: 24000,
          performanceWeight: 0.15,
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
        },
        {
          id: "product-p6",
          departmentId: 21,
          salaryGradeCode: "P6",
          jobLevel: 6,
          baseSalary: 26000,
          performanceWeight: 0.2,
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
        },
      ],
      taskBonusAllocations: [
        { employeeProfileId: 11, payrollMonth: "2026-08-01", amount: 3200 },
        { employeeProfileId: 11, payrollMonth: "2026-08-01", amount: 1600 },
        { employeeProfileId: 11, payrollMonth: "2026-07-01", amount: 900 },
        { employeeProfileId: 12, payrollMonth: "2026-08-01", amount: 5000 },
      ],
      performanceScore: 90,
      otherBonus: 500,
      deductions: {
        socialSecurity: 1800,
        individualIncomeTax: 950,
        otherDeduction: 250,
      },
    });

    expect(result).toEqual({
      policyId: "product-p6",
      payrollMonth: "2026-08-01",
      baseSalary: 26000,
      performanceBonus: 4680,
      projectBonus: 4800,
      otherBonus: 500,
      bonus: 9980,
      deductions: 3000,
      netSalary: 32980,
      detail: {
        departmentPolicyMatched: true,
        performanceWeight: 0.2,
        performanceScore: 90,
        allocationCount: 2,
      },
    });
  });

  it("fails closed when no active salary policy matches the employee grade", () => {
    expect(() =>
      calculateMonthlyCompensation({
        payrollMonth: "2026-08-01",
        employee: {
          employeeProfileId: 11,
          departmentId: 21,
          salaryGradeCode: "P7",
          jobLevel: 7,
        },
        policies: [],
        taskBonusAllocations: [],
        performanceScore: 85,
        otherBonus: 0,
        deductions: {
          socialSecurity: 0,
          individualIncomeTax: 0,
          otherDeduction: 0,
        },
      }),
    ).toThrow("salary_policy_not_found");
  });
});
