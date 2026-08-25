import { describe, expect, it, vi } from "vitest";

import { createWorkstationPayrollHandler } from "@/app/api/workstation/payroll/handler";

const validBody = {
  memberId: "m8",
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
  otherDeduction: "100.00",
  manualAdjustmentReason: "补扣",
  openingCumulativeIncome: "100000.00",
  openingCumulativeTaxExemptIncome: "0.00",
  openingCumulativeSpecialDeduction: "12000.00",
  openingCumulativeSpecialAdditionalDeduction: "0.00",
  openingCumulativeOtherStatutoryDeduction: "0.00",
  openingCumulativeTaxRelief: "0.00",
  openingCumulativeTaxWithheld: "2500.00",
  status: "draft",
  note: "八月工资",
};

const session = {
  member: { id: 7 },
  organization: { id: "organization-public-id" },
  permissionCodes: ["salary.manage"],
};

const calculatedFixture = {
  employee: { profileId: 101, memberId: 8, hireDate: "2026-01-15" },
  policy: { publicId: "policy-1", effectiveMonth: "2026-07" },
  employmentMonthsYtd: 8,
  openingRequired: true,
  opening: {
    openingCumulativeIncome: "100000.00",
    openingCumulativeTaxExemptIncome: "0.00",
    openingCumulativeSpecialDeduction: "12000.00",
    openingCumulativeSpecialAdditionalDeduction: "0.00",
    openingCumulativeOtherStatutoryDeduction: "0.00",
    openingCumulativeTaxRelief: "0.00",
    openingCumulativeTaxWithheld: "2500.00",
  },
  normalizedInput: { memberId: 8, month: "2026-08", baseSalary: "20000.00" },
  calculation: {
    grossSalary: "25000.00",
    bonus: "5000.00",
    pensionEmployee: "1600.00",
    medicalEmployee: "403.00",
    unemploymentEmployee: "100.00",
    housingFundEmployee: "1400.00",
    socialSecurity: "3503.00",
    cumulativeTaxableIncome: "100000.00",
    individualIncomeTax: "800.00",
    deductions: "4403.00",
    netSalary: "20597.00",
    cumulative: { income: "125000.00" },
  },
  calculationVersion: "cn-cumulative-withholding-v1",
};

function request(body: unknown = validBody) {
  return new Request("https://workspace.test/api/workstation/payroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("formal workstation payroll update", () => {
  it("requires salary management permission", async () => {
    const calculate = vi.fn();
    const saveCalculatedPayroll = vi.fn();
    const handler = createWorkstationPayrollHandler({
      loadSession: async () => ({ ...session, permissionCodes: ["salary.self"] }),
      calculate,
      saveCalculatedPayroll,
    });

    const response = await handler(request());

    expect(response.status).toBe(403);
    expect(calculate).not.toHaveBeenCalled();
    expect(saveCalculatedPayroll).not.toHaveBeenCalled();
  });

  it("recalculates and saves immutable server snapshots", async () => {
    const calculate = vi.fn().mockResolvedValue(calculatedFixture);
    const saveCalculatedPayroll = vi.fn().mockResolvedValue({ status: "saved" });
    const handler = createWorkstationPayrollHandler({
      loadSession: async () => session,
      calculate,
      saveCalculatedPayroll,
    });

    const response = await handler(request({
      ...validBody,
      actorMemberId: 999,
      grossSalary: "1.00",
      individualIncomeTax: "1.00",
      deductions: "1.00",
      netSalary: "999999.00",
      employmentMonthsYtd: 12,
    }));

    expect(response.status).toBe(200);
    expect(calculate).toHaveBeenCalledWith({
      actorMemberId: 7,
      organizationPublicId: "organization-public-id",
    }, expect.not.objectContaining({ employmentMonthsYtd: expect.anything() }));
    expect(saveCalculatedPayroll).toHaveBeenCalledWith(expect.objectContaining({
      context: {
        actorMemberId: 7,
        organizationPublicId: "organization-public-id",
      },
      result: calculatedFixture,
    }));
  });

  it("rejects paid status at the public boundary", async () => {
    const calculate = vi.fn();
    const saveCalculatedPayroll = vi.fn();
    const handler = createWorkstationPayrollHandler({
      loadSession: async () => session,
      calculate,
      saveCalculatedPayroll,
    });

    const response = await handler(request({ ...validBody, status: "paid" }));

    expect(response.status).toBe(400);
    expect(calculate).not.toHaveBeenCalled();
    expect(saveCalculatedPayroll).not.toHaveBeenCalled();
  });
});
