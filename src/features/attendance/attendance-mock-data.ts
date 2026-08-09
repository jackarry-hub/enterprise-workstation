import type { AttendanceRecord, AttendanceResult } from "@/features/attendance/attendance-types";
import { mockDepartments, mockEmployees } from "@/features/hr/employee-mock-data";

const organizationId = "10000000-0000-4000-8000-000000000001";

type RecordSeed = {
  employeeIndex: number;
  checkIn?: string;
  checkOut?: string;
  status: AttendanceRecord["status"];
  lateMinutes?: number;
  earlyLeaveMinutes?: number;
  note?: string;
};

const seeds: RecordSeed[] = [
  { employeeIndex: 0, checkIn: "08:52", checkOut: "18:06", status: "normal" },
  { employeeIndex: 1, checkIn: "09:14", checkOut: "18:03", status: "late", lateMinutes: 14, note: "早高峰交通延误" },
  { employeeIndex: 2, checkIn: "08:47", checkOut: "18:18", status: "normal" },
  { employeeIndex: 3, checkIn: "08:58", checkOut: "17:22", status: "early_leave", earlyLeaveMinutes: 38, note: "外出客户沟通" },
  { employeeIndex: 4, checkIn: "08:55", checkOut: "18:01", status: "normal" },
  { employeeIndex: 5, checkIn: "09:09", checkOut: "18:20", status: "late", lateMinutes: 9 },
  { employeeIndex: 6, checkIn: "08:51", checkOut: "17:58", status: "normal" },
  { employeeIndex: 7, status: "leave", note: "年假 · 已审批" },
  { employeeIndex: 8, checkIn: "08:59", checkOut: "18:08", status: "normal" },
];

const records: AttendanceRecord[] = seeds.map((seed, index) => {
  const employeeItem = mockEmployees[seed.employeeIndex];
  return {
    id: `71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    organizationId,
    employee: {
      id: employeeItem.profile.id,
      employeeNo: employeeItem.profile.employeeNo,
      displayName: employeeItem.profile.displayName,
      avatarUrl: employeeItem.profile.avatarUrl,
      jobTitle: employeeItem.profile.jobTitle,
    },
    department: employeeItem.department
      ? { id: employeeItem.department.id, name: employeeItem.department.name }
      : undefined,
    attendanceDate: "2026-08-04",
    scheduledStart: "09:00",
    scheduledEnd: "18:00",
    checkIn: seed.checkIn,
    checkOut: seed.checkOut,
    status: seed.status,
    lateMinutes: seed.lateMinutes ?? 0,
    earlyLeaveMinutes: seed.earlyLeaveMinutes ?? 0,
    source: "device",
    note: seed.note,
  };
});

export const attendanceMockResult: AttendanceResult = {
  source: "mock",
  data: {
    records,
    departments: mockDepartments.map(({ id, name }) => ({ id, name })),
    stats: {
      presentToday: 119,
      lateToday: 6,
      leaveToday: 3,
      monthlyAttendanceRate: 92.6,
    },
    trend: [
      { date: "2026-07-24", label: "07/24", attendanceRate: 93.2, late: 4, leave: 2 },
      { date: "2026-07-27", label: "07/27", attendanceRate: 91.8, late: 7, leave: 4 },
      { date: "2026-07-28", label: "07/28", attendanceRate: 94.1, late: 3, leave: 3 },
      { date: "2026-07-29", label: "07/29", attendanceRate: 92.4, late: 5, leave: 4 },
      { date: "2026-07-30", label: "07/30", attendanceRate: 95.3, late: 2, leave: 2 },
      { date: "2026-07-31", label: "07/31", attendanceRate: 93.7, late: 4, leave: 3 },
      { date: "2026-08-03", label: "08/03", attendanceRate: 91.9, late: 7, leave: 3 },
      { date: "2026-08-04", label: "08/04", attendanceRate: 92.6, late: 6, leave: 3 },
    ],
  },
};
