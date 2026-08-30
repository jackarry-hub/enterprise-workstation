import type {
  EmployeeDirectoryFilters,
  EmployeeDirectoryItem,
  EmployeeDirectoryResult,
} from "@/features/hr/employee-types";

export function filterEmployees(
  employees: EmployeeDirectoryItem[],
  filters: EmployeeDirectoryFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");

  return employees.filter(({ profile, department }) => {
    const matchesQuery = !query || [
      profile.displayName,
      profile.employeeNo,
      profile.jobTitle,
      department?.name,
    ].some((value) => value?.toLocaleLowerCase("zh-CN").includes(query));
    const matchesDepartment = filters.departmentId === "all"
      || profile.departmentId === filters.departmentId;
    const matchesStatus = filters.status === "all"
      || profile.employmentStatus === filters.status;

    return matchesQuery && matchesDepartment && matchesStatus;
  });
}

export function getEmployeeDetail(
  publicId: string,
  directory: EmployeeDirectoryResult,
) {
  return directory.data.employees.find(({ profile }) => profile.id === publicId);
}
