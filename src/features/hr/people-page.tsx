import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";
import type { EmployeeDirectoryResult } from "@/features/hr/employee-types";
import { PeopleWorkspace } from "@/features/hr/people-workspace";

export function PeoplePage({
  result = employeeDirectoryMockResult,
}: {
  result?: EmployeeDirectoryResult;
}) {
  return <PeopleWorkspace result={result} />;
}
