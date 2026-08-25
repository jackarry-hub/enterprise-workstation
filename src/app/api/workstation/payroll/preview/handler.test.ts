import { describe, expect, it, vi } from "vitest";

import { createPayrollPreviewHandler } from "./handler";

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

const session = {
  member: { id: 7 },
  organization: { id: "organization-public-id" },
  permissionCodes: ["salary.manage"],
};

function request(body: unknown = validBody) {
  return new Request("https://workspace.test/api/workstation/payroll/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("payroll preview API", () => {
  it("returns a server calculation without persistence", async () => {
    const calculated = {
      policy: { publicId: "policy-1", effectiveMonth: "2026-07" },
      calculation: { grossSalary: "25000.00", netSalary: "20900.00" },
      employmentMonthsYtd: 8,
      openingRequired: true,
    };
    const preview = vi.fn().mockResolvedValue(calculated);
    const response = await createPayrollPreviewHandler({
      loadSession: async () => session,
      preview,
    })(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(calculated);
    expect(preview).toHaveBeenCalledWith({
      actorMemberId: 7,
      organizationPublicId: "organization-public-id",
    }, expect.objectContaining({
      memberId: 8,
      month: "2026-08",
      baseSalary: "20000.00",
    }));
  });

  it("requires authentication and salary management permission", async () => {
    const preview = vi.fn();
    const unauthorized = await createPayrollPreviewHandler({
      loadSession: async () => null,
      preview,
    })(request());
    const forbidden = await createPayrollPreviewHandler({
      loadSession: async () => ({ ...session, permissionCodes: ["salary.self"] }),
      preview,
    })(request());

    expect(unauthorized.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(preview).not.toHaveBeenCalled();
  });

  it("maps missing payroll context to a stable conflict response", async () => {
    const response = await createPayrollPreviewHandler({
      loadSession: async () => session,
      preview: async () => {
        const error = new Error("missing_opening_cumulative") as Error & { code: string };
        error.code = "missing_opening_cumulative";
        throw error;
      },
    })(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "missing_opening_cumulative" });
  });
});
