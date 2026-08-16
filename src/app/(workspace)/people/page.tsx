import type { Metadata } from "next";

import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { PeoplePage } from "@/features/hr/people-page";
import { isCustomerDemoMode } from "@/features/demo/customer-demo-mode";
import type { EmployeeDirectoryResult } from "@/features/hr/employee-types";
import {
  createOperationFixtureContext,
  type WorkspaceIdentityContext,
} from "@/features/operations/operation-actor-compat";

export const metadata: Metadata = {
  title: "组织人事 | 量子智枢",
};

export default async function PeopleRoute() {
  const session = await requireWorkspaceSession();
  const identityContext: WorkspaceIdentityContext =
    createOperationFixtureContext(session);
  if (!identityContext.actor) {
    const result: EmployeeDirectoryResult = {
      source: "supabase",
      data: {
        employees: [],
        departments: [],
        stats: { total: 0, active: 0, probation: 0, departments: 0 },
      },
    };
    return <PeoplePage result={result} />;
  }

  const { loadEmployeeDirectory } = await import("@/features/hr/employee-data");
  const result = await loadEmployeeDirectory(
    undefined,
    { allowMockFallback: isCustomerDemoMode() },
  );
  return <PeoplePage result={result} />;
}
