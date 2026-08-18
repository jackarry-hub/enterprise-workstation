import { describe, expect, it, vi } from "vitest";

import { createWorkstationPayrollHandler } from "@/app/api/workstation/payroll/handler";

const validBody = {
  memberId: "m8",
  month: "2026-08",
  baseSalary: 20000,
  performanceBonus: 1500,
  projectBonus: 3000,
  otherBonus: 500,
  socialSecurity: 1200,
  individualIncomeTax: 800,
  otherDeduction: 100,
  status: "paid",
};

describe("formal workstation payroll update", () => {
  it("requires salary management permission", async () => {
    const savePayroll = vi.fn();
    const handler = createWorkstationPayrollHandler({
      loadSession: async () => ({ member: { id: 7 }, permissionCodes: ["salary.self"] }),
      savePayroll,
    });

    const response = await handler(new Request("https://workspace.test/api/workstation/payroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    }));

    expect(response.status).toBe(403);
    expect(savePayroll).not.toHaveBeenCalled();
  });

  it("calculates totals on the server and saves for the selected colleague", async () => {
    const savePayroll = vi.fn().mockResolvedValue({ status: "saved" });
    const handler = createWorkstationPayrollHandler({
      loadSession: async () => ({ member: { id: 7 }, permissionCodes: ["salary.manage"] }),
      savePayroll,
    });

    const response = await handler(new Request("https://workspace.test/api/workstation/payroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, actorMemberId: 999, netSalary: 1 }),
    }));

    expect(response.status).toBe(200);
    expect(savePayroll).toHaveBeenCalledWith({
      actorMemberId: 7,
      employeeMemberId: 8,
      payrollMonth: "2026-08-01",
      baseSalary: 20000,
      performanceBonus: 1500,
      projectBonus: 3000,
      otherBonus: 500,
      socialSecurity: 1200,
      individualIncomeTax: 800,
      otherDeduction: 100,
      bonus: 5000,
      deductions: 2100,
      netSalary: 22900,
      status: "paid",
    });
  });

  it("rejects deductions larger than gross salary", async () => {
    const savePayroll = vi.fn();
    const handler = createWorkstationPayrollHandler({
      loadSession: async () => ({ member: { id: 7 }, permissionCodes: ["salary.manage"] }),
      savePayroll,
    });

    const response = await handler(new Request("https://workspace.test/api/workstation/payroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, socialSecurity: 100000 }),
    }));

    expect(response.status).toBe(400);
    expect(savePayroll).not.toHaveBeenCalled();
  });
});
