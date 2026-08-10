import type { Metadata } from "next";

import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import {
  createOperationFixtureContext,
  type WorkspaceIdentityContext,
} from "@/features/operations/operation-actor-compat";
import { PayrollPage } from "@/features/salary/payroll-page";
import type { SalaryResult } from "@/features/salary/salary-types";

export const metadata: Metadata = { title: "薪资管理 | 企业工作站" };

export default async function PayrollRoute() {
  const session = await requireWorkspaceSession();
  const identityContext: WorkspaceIdentityContext =
    createOperationFixtureContext(session);
  if (!identityContext.actor) {
    const result: SalaryResult = {
      source: "supabase",
      data: {
        records: [],
        departments: [],
        stats: { totalSalary: 0, employeeCount: 0, averageSalary: 0 },
      },
    };
    return <PayrollPage result={result} />;
  }

  const { loadSalary } = await import("@/features/salary/salary-data");
  const result = await loadSalary();
  return <PayrollPage result={result} />;
}
