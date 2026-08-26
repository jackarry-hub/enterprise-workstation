import type { EmployeeDirectoryResult } from "@/features/hr/employee-types";
import { PeopleWorkspace } from "@/features/hr/people-workspace";
import type { RoleCommandTarget } from "@/features/organization/organization-command-data";

export function PeoplePage({
  result,
  roleTargets = [],
}: {
  result: EmployeeDirectoryResult;
  roleTargets?: readonly RoleCommandTarget[];
}) {
  return <PeopleWorkspace result={result} roleTargets={roleTargets} />;
}
