import type { PayrollRun, PayrollRunStatus } from "@/features/operations/operations-types";

const statusOrder: Record<PayrollRunStatus, number> = {
  draft: 0,
  calculated: 1,
  verified: 2,
  approved: 3,
  paid: 4,
};

export const payrollWorkflowNodes = [
  { id: "attendance", label: "考勤封账", owner: "人事", ownerActorId: "actor-hr" },
  { id: "calculated", label: "薪资核算", owner: "财务", ownerActorId: "actor-finance" },
  { id: "verified", label: "工资单复核", owner: "人事", ownerActorId: "actor-hr" },
  { id: "approved", label: "发放批准", owner: "决策人", ownerActorId: "actor-executive" },
  { id: "paid", label: "银行发放", owner: "财务", ownerActorId: "actor-finance" },
] as const;

export type PayrollWorkflowNodeId = typeof payrollWorkflowNodes[number]["id"];

function isNodeDone(run: PayrollRun, id: PayrollWorkflowNodeId) {
  if (id === "attendance") return run.attendanceLocked;
  return statusOrder[run.status] >= statusOrder[id];
}

export function getPayrollWorkflowProgress(run: PayrollRun) {
  const steps = payrollWorkflowNodes.map((step) => ({
    ...step,
    done: isNodeDone(run, step.id),
  }));
  const completed = steps.filter(({ done }) => done).length;
  const total = steps.length;

  return {
    steps,
    completed,
    total,
    percentage: Math.round(completed / total * 100),
    current: steps.find(({ done }) => !done) ?? null,
  };
}
