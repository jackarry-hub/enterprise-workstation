import type { EmployeeDirectoryResult } from "@/features/hr/employee-types";
import { PeopleWorkspace } from "@/features/hr/people-workspace";
import type {
  ManagerCommandTargetsResult,
  RoleCommandTarget,
} from "@/features/organization/organization-command-data";

export function PeoplePage({
  result,
  roleTargets = [],
  managerTargets = { status: "ready", targets: [] },
}: {
  result: EmployeeDirectoryResult;
  roleTargets?: readonly RoleCommandTarget[];
  managerTargets?: ManagerCommandTargetsResult;
}) {
  return <PeopleWorkspace result={result} roleTargets={roleTargets} managerTargets={managerTargets} />;
}
