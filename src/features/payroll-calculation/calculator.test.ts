import { describe, expect, it } from "vitest";

import { calculatePayroll } from "./calculator";
import { parseMoney } from "./money";
import type {
  PayrollCalculationInput,
  PayrollPolicyInput,
  PriorPayrollTotals,
} from "./types";

const policy: PayrollPolicyInput = {
  id: "policy-2026-08",
  effectiveMonth: "2026-08",
  pensionEmployeeRate: "8",
  medicalEmployeeRate: "2",
  medicalEmployeeFixedAmount: "2.00",
  unemploymentEmployeeRate: "0.5",
  housingFundEmployeeRate: "7",
  socialBaseMin: "4000.00",
  socialBaseMax: "20000.00",
  housingBaseMin: "4000.00",
  housingBaseMax: "20000.00",
};

const input: PayrollCalculationInput = {
  month: "2026-08",
  employmentMonthsYtd: 8,
  baseSalary: "20000.00",
  performanceBonus: "3000.00",
  projectBonus: "1000.00",
  otherBonus: "500.00",
  otherIncome: "500.00",
  socialBase: "25000.00",
  housingFundBase: "20000.00",
  taxExemptIncome: "0.00",
  specialAdditionalDeduction: "1000.00",
  otherStatutoryDeduction: "0.00",
  taxRelief: "0.00",
  otherDeduction: "0.00",
  manualAdjustmentReason: "",
  openingCumulativeIncome: "0.00",
  openingCumulativeTaxExemptIncome: "0.00",
  openingCumulativeSpecialDeduction: "0.00",
  openingCumulativeSpecialAdditionalDeduction: "0.00",
  openingCumulativeOtherStatutoryDeduction: "0.00",
  openingCumulativeTaxRelief: "0.00",
  openingCumulativeTaxWithheld: "0.00",
};

const prior: PriorPayrollTotals = {
  cumulativeIncome: parseMoney("100000.00"),
  cumulativeTaxExemptIncome: BigInt(0),
  cumulativeSpecialDeduction: parseMoney("24514.00"),
  cumulativeSpecialAdditionalDeduction: parseMoney("7000.00"),
  cumulativeOtherStatutoryDeduction: BigInt(0),
  cumulativeTaxRelief: BigInt(0),
  cumulativeTaxWithheld: parseMoney("1758.40"),
};

describe("payroll calculation", () => {
  it("clamps contribution bases and calculates gross, deductions, and net pay", () => {
    const result = calculatePayroll(policy, input, prior);

    expect(result.grossSalary).toBe("25000.00");
    expect(result.bonus).toBe("4500.00");
    expect(result.pensionEmployee).toBe("1600.00");
    expect(result.medicalEmployee).toBe("402.00");
    expect(result.unemploymentEmployee).toBe("100.00");
    expect(result.housingFundEmployee).toBe("1400.00");
    expect(result.socialSecurity).toBe("3502.00");
    expect(result.cumulativeTaxableIncome).toBe("48984.00");
    expect(result.individualIncomeTax).toBe("620.00");
    expect(result.deductions).toBe("4122.00");
    expect(result.netSalary).toBe("20878.00");
    expect(result.taxBracket).toEqual({
      rate: "10",
      quickDeduction: "2520.00",
    });
  });

  it("clamps contribution bases up to the configured minimum", () => {
    const result = calculatePayroll(policy, {
      ...input,
      socialBase: "0.00",
      housingFundBase: "0.00",
    }, prior);

    expect(result.pensionEmployee).toBe("320.00");
    expect(result.medicalEmployee).toBe("82.00");
    expect(result.unemploymentEmployee).toBe("20.00");
    expect(result.housingFundEmployee).toBe("280.00");
  });

  it("adds opening cumulative values before applying the tax table", () => {
    const result = calculatePayroll(policy, {
      ...input,
      openingCumulativeIncome: "10000.00",
      openingCumulativeTaxWithheld: "100.00",
    }, prior);

    expect(result.cumulative.income).toBe("135000.00");
    expect(result.cumulative.taxWithheld).toBe("3378.40");
    expect(result.individualIncomeTax).toBe("1520.00");
  });

  it("requires a reason for a manual deduction", () => {
    expect(() => calculatePayroll(policy, {
      ...input,
      otherDeduction: "100.00",
      manualAdjustmentReason: "",
    }, prior)).toThrow("missing_adjustment_reason");
  });

  it("rejects a negative net salary", () => {
    expect(() => calculatePayroll(policy, {
      ...input,
      otherDeduction: "30000.00",
      manualAdjustmentReason: "工资更正",
    }, prior)).toThrow("negative_net_salary");
  });
});
