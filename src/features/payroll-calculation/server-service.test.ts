import { describe, expect, it, vi } from "vitest";

import {
  calculatePayrollForActor,
  createPayrollRepository,
  type PayrollCalculationDependencies,
  type PayrollEmployee,
  type PayrollHistoryRow,
  type PayrollPolicyRecord,
  type PayrollSaveRequest,
} from "./server-service";

const actor = { memberId: 7, organizationId: 2 };

const input: PayrollSaveRequest = {
  memberId: 8,
  month: "2026-08",
  baseSalary: "20000.00",
  performanceBonus: "1500.00",
  projectBonus: "3000.00",
  otherBonus: "500.00",
  otherIncome: "0.00",
  socialBase: "20000.00",
  housingFundBase: "20000.00",
  taxExemptIncome: "0.00",
  specialAdditionalDeduction: "0.00",
  otherStatutoryDeduction: "0.00",
  taxRelief: "0.00",
  otherDeduction: "0.00",
  manualAdjustmentReason: "",
  openingCumulativeIncome: "100000.00",
  openingCumulativeTaxExemptIncome: "0.00",
  openingCumulativeSpecialDeduction: "12000.00",
  openingCumulativeSpecialAdditionalDeduction: "0.00",
  openingCumulativeOtherStatutoryDeduction: "0.00",
  openingCumulativeTaxRelief: "0.00",
  openingCumulativeTaxWithheld: "2500.00",
  status: "draft",
  note: "",
};

function policy(effectiveMonth: string): PayrollPolicyRecord {
  return {
    publicId: `policy-${effectiveMonth}`,
    status: "active",
    effectiveMonth,
    pensionEmployeeRate: "0.080000",
    medicalEmployeeRate: "0.020000",
    medicalEmployeeFixedAmount: "3.00",
    unemploymentEmployeeRate: "0.005000",
    housingFundEmployeeRate: "0.070000",
    socialBaseMin: "5000.00",
    socialBaseMax: "30000.00",
    housingBaseMin: "5000.00",
    housingBaseMax: "30000.00",
  };
}

function dependencies(overrides: {
  employee?: PayrollEmployee | null;
  policies?: PayrollPolicyRecord[];
  history?: PayrollHistoryRow[];
} = {}): PayrollCalculationDependencies {
  return {
    loadEmployee: async () => overrides.employee === undefined
      ? { profileId: 101, memberId: 8, hireDate: "2026-01-15" }
      : overrides.employee,
    loadPolicies: async () => overrides.policies ?? [policy("2026-01")],
    loadYearHistory: async () => overrides.history ?? [],
  };
}

function confirmedHistory(month: string): PayrollHistoryRow {
  return {
    month,
    status: "processing",
    calculationVersion: "cn-cumulative-withholding-v1",
    grossSalary: "10000.00",
    taxExemptIncome: "0.00",
    socialSecurity: "1500.00",
    specialAdditionalDeduction: "0.00",
    otherStatutoryDeduction: "0.00",
    taxRelief: "0.00",
    individualIncomeTax: "100.00",
    openingCumulativeIncome: "20000.00",
    openingCumulativeTaxExemptIncome: "0.00",
    openingCumulativeSpecialDeduction: "3000.00",
    openingCumulativeSpecialAdditionalDeduction: "0.00",
    openingCumulativeOtherStatutoryDeduction: "0.00",
    openingCumulativeTaxRelief: "0.00",
    openingCumulativeTaxWithheld: "150.00",
  };
}

describe("server payroll calculation context", () => {
  it("loads employee calculation facts through the scoped payroll RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        profile_id: 101,
        organization_member_id: 8,
        hire_date: "2026-01-15",
      }],
      error: null,
    });
    const from = vi.fn(() => {
      throw new Error("employee facts must not use a direct table query");
    });
    const repository = createPayrollRepository({ rpc, from } as never);

    await expect(repository.loadEmployee(2, 8)).resolves.toEqual({
      profileId: 101,
      memberId: 8,
      hireDate: "2026-01-15",
    });
    expect(rpc).toHaveBeenCalledWith("current_payroll_employee_facts", {
      p_employee_member_id: 8,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("uses the latest active policy not later than payroll month", async () => {
    const result = await calculatePayrollForActor(actor, input, dependencies({
      policies: [policy("2026-01"), policy("2026-07"), policy("2026-09")],
    }));

    expect(result.policy.effectiveMonth).toBe("2026-07");
  });

  it("requires opening cumulative values when hire date predates the first in-system payroll month", async () => {
    await expect(calculatePayrollForActor(actor, {
      ...input,
      openingCumulativeIncome: "",
    }, dependencies())).rejects.toMatchObject({
      code: "missing_opening_cumulative",
    });
  });

  it("uses zero opening totals when the employee is hired in the selected month", async () => {
    const result = await calculatePayrollForActor(actor, {
      ...input,
      openingCumulativeIncome: "",
      openingCumulativeSpecialDeduction: "",
      openingCumulativeTaxWithheld: "",
    }, dependencies({
      employee: { profileId: 101, memberId: 8, hireDate: "2026-08-01" },
    }));

    expect(result.employmentMonthsYtd).toBe(1);
    expect(result.openingRequired).toBe(false);
    expect(result.calculation.cumulative.income).toBe(
      result.calculation.grossSalary,
    );
  });

  it("derives employment months and never accepts a client override", async () => {
    const result = await calculatePayrollForActor(actor, {
      ...input,
      employmentMonthsYtd: 12,
    } as PayrollSaveRequest & { employmentMonthsYtd: number }, dependencies({
      employee: { profileId: 101, memberId: 8, hireDate: "2026-06-20" },
      history: [],
    }));

    expect(result.employmentMonthsYtd).toBe(3);
  });

  it("blocks a missing or future hire date", async () => {
    await expect(calculatePayrollForActor(actor, input, dependencies({
      employee: { profileId: 101, memberId: 8, hireDate: null },
    }))).rejects.toMatchObject({ code: "employee_hire_date_missing" });

    await expect(calculatePayrollForActor(actor, input, dependencies({
      employee: { profileId: 101, memberId: 8, hireDate: "2026-09-01" },
    }))).rejects.toMatchObject({ code: "employee_hire_date_missing" });
  });

  it("reuses the immutable opening snapshot from confirmed history", async () => {
    const history = [
      confirmedHistory("2026-05"),
      confirmedHistory("2026-06"),
      confirmedHistory("2026-07"),
    ];
    const result = await calculatePayrollForActor(actor, {
      ...input,
      openingCumulativeIncome: "",
      openingCumulativeSpecialDeduction: "",
      openingCumulativeTaxWithheld: "",
    }, dependencies({ history }));

    expect(result.opening.openingCumulativeIncome).toBe("20000.00");
    expect(result.prior.cumulativeIncome).toBe(BigInt(3_000_000));
  });

  it("fails when confirmed history has a gap", async () => {
    await expect(calculatePayrollForActor(actor, input, dependencies({
      history: [confirmedHistory("2026-05"), confirmedHistory("2026-07")],
    }))).rejects.toMatchObject({ code: "missing_history" });
  });

  it("rejects changes to an existing immutable opening snapshot", async () => {
    const history = [
      confirmedHistory("2026-06"),
      confirmedHistory("2026-07"),
    ];
    await expect(calculatePayrollForActor(actor, {
      ...input,
      openingCumulativeIncome: "999.00",
    }, dependencies({ history }))).rejects.toMatchObject({
      code: "opening_cumulative_mismatch",
    });
  });

  it("maps invalid payroll amounts and adjustments to invalid_request", async () => {
    await expect(calculatePayrollForActor(actor, {
      ...input,
      otherDeduction: "10.00",
      manualAdjustmentReason: "",
    }, dependencies())).rejects.toMatchObject({ code: "invalid_request" });
  });
});
