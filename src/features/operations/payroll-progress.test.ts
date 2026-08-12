import { describe, expect, it } from "vitest";

import { getPayrollWorkflowProgress } from "@/features/operations/payroll-progress";
import type { PayrollRun } from "@/features/operations/operations-types";

const baseRun: PayrollRun = {
  id: "payroll-demo",
  month: "2026-08",
  status: "draft",
  headcount: 10,
  grossAmount: 100_000,
  deductionAmount: 10_000,
  netAmount: 90_000,
  attendanceLocked: false,
  exceptionCount: 0,
  updatedAt: "2026-08-12T08:00:00.000Z",
};

describe("payroll workflow progress", () => {
  it.each([
    [{ status: "draft", attendanceLocked: false }, 0],
    [{ status: "draft", attendanceLocked: true }, 20],
    [{ status: "calculated", attendanceLocked: true }, 40],
    [{ status: "verified", attendanceLocked: true }, 60],
    [{ status: "approved", attendanceLocked: true }, 80],
    [{ status: "paid", attendanceLocked: true }, 100],
  ] as const)("maps a payroll state to %s%%", (patch, expected) => {
    expect(getPayrollWorkflowProgress({ ...baseRun, ...patch }).percentage).toBe(expected);
  });

  it("keeps five visible business nodes in the customer demonstration", () => {
    const progress = getPayrollWorkflowProgress(baseRun);

    expect(progress.steps.map(({ label }) => label)).toEqual([
      "考勤封账",
      "薪资核算",
      "工资单复核",
      "发放批准",
      "银行发放",
    ]);
    expect(progress.total).toBe(5);
    expect(progress.completed).toBe(0);
  });
});
