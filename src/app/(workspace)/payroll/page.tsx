import type { Metadata } from "next";

import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { PayrollPage } from "@/features/salary/payroll-page";
import type { SalaryResult } from "@/features/salary/salary-types";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "薪资管理 | 企业工作站" };

function canManageSalary(session: Awaited<ReturnType<typeof requireWorkspaceSession>>) {
  return session.isAdmin
    || session.roleCodes.some((role) => ["owner", "admin", "finance"].includes(role))
    || session.permissionCodes.includes("salary.manage");
}

export default async function PayrollRoute() {
  const session = await requireWorkspaceSession();
  const fixtureContext = createOperationFixtureContext(session);
  const { loadSalary } = await import("@/features/salary/salary-data");
  if (fixtureContext.actor) {
    const result = await loadSalary();
    return <PayrollPage result={result} />;
  }
  if (!hasSupabaseEnv()) {
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
  const result = await loadSalary(undefined, {
    allowMockFallback: false,
    viewerEmployeeProfileId: session.member.employeeProfileId,
    canManageSalary: canManageSalary(session),
  });
  return <PayrollPage result={result} />;
}
