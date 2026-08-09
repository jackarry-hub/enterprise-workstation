import type { SalaryFilters, SalaryResult } from "@/features/salary/salary-types";

export function filterSalaryRecords(records: SalaryResult["data"]["records"], filters: SalaryFilters) {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  return records.filter((record) => {
    const matchesQuery = !query || [record.employee.displayName, record.employee.employeeNo, record.employee.jobTitle, record.department.name]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
    const matchesDepartment = filters.departmentId === "all" || record.department.id === filters.departmentId;
    const matchesMonth = filters.month === "all" || record.month === filters.month;
    const matchesStatus = filters.status === "all" || record.status === filters.status;
    return matchesQuery && matchesDepartment && matchesMonth && matchesStatus;
  });
}

export function getSalaryDetail(publicId: string, result: SalaryResult) {
  return result.data.records.find((record) => record.id === publicId);
}
