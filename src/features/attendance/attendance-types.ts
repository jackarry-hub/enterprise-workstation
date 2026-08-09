import type { Department, EmployeeProfile } from "@/features/hr/employee-types";

export type AttendanceStatus = "normal" | "late" | "early_leave" | "leave";
export type AttendanceSource = "manual" | "import" | "device";

export type AttendanceRecord = {
  id: string;
  organizationId: string;
  employee: Pick<EmployeeProfile, "id" | "employeeNo" | "displayName" | "avatarUrl" | "jobTitle">;
  department?: Pick<Department, "id" | "name">;
  attendanceDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  checkIn?: string;
  checkOut?: string;
  status: AttendanceStatus;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  source: AttendanceSource;
  note?: string;
};

export type AttendanceStats = {
  presentToday: number;
  lateToday: number;
  leaveToday: number;
  monthlyAttendanceRate: number;
};

export type AttendanceTrendPoint = {
  date: string;
  label: string;
  attendanceRate: number;
  late: number;
  leave: number;
};

export type AttendanceFilters = {
  query: string;
  departmentId: string | "all";
  date: string | "all";
  status: AttendanceStatus | "all";
};

export type AttendanceData = {
  records: AttendanceRecord[];
  departments: Array<Pick<Department, "id" | "name">>;
  stats: AttendanceStats;
  trend: AttendanceTrendPoint[];
  loadError?: string;
};

export type AttendanceResult = {
  source: "mock" | "supabase";
  data: AttendanceData;
};
