import type {
  AttendanceFilters,
  AttendanceRecord,
} from "@/features/attendance/attendance-types";

export function filterAttendanceRecords(
  records: AttendanceRecord[],
  filters: AttendanceFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");

  return records.filter((record) => {
    const matchesQuery = !query || [
      record.employee.displayName,
      record.employee.employeeNo,
      record.employee.jobTitle,
      record.department?.name,
    ].some((value) => value?.toLocaleLowerCase("zh-CN").includes(query));
    const matchesDepartment = filters.departmentId === "all"
      || record.department?.id === filters.departmentId;
    const matchesDate = filters.date === "all"
      || record.attendanceDate === filters.date;
    const matchesStatus = filters.status === "all"
      || record.status === filters.status;

    return matchesQuery && matchesDepartment && matchesDate && matchesStatus;
  });
}

export function getAttendanceAnomalies(records: AttendanceRecord[]) {
  return records.filter((record) => record.status !== "normal");
}
