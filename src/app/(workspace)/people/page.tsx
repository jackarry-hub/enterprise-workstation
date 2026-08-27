import type { Metadata } from "next";

import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { PeoplePage } from "@/features/hr/people-page";
import { loadEmployeeDirectory } from "@/features/hr/employee-data";
import {
  loadManagerCommandTargets,
  loadRoleCommandTargets,
} from "@/features/organization/organization-command-data";

export const metadata: Metadata = {
  title: "组织人事 | 企业工作站",
};

export default async function PeopleRoute() {
  const session = await requireWorkspaceSession();
  const [result, roleTargets, managerTargets] = await Promise.all([
    loadEmployeeDirectory(session.organization.id, undefined, { allowMockFallback: false }),
    session.permissionCodes.includes("role.manage")
      ? loadRoleCommandTargets(session)
      : Promise.resolve([]),
    session.permissionCodes.includes("organization.manage")
      ? loadManagerCommandTargets(session)
      : Promise.resolve({ status: "ready" as const, targets: [] }),
  ]);
  return <PeoplePage result={result} roleTargets={roleTargets} managerTargets={managerTargets} />;
}
