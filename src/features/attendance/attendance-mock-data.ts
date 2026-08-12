import type { AttendanceRecord, AttendanceResult } from "@/features/attendance/attendance-types";
import { CUSTOMER_DEMO_ORGANIZATION_ID, getCustomerDemoPerson } from "@/features/demo/customer-demo-data";
import { mockDepartments, mockEmployees } from "@/features/hr/employee-mock-data";

type RecordSeed = {
  personId: string;
  checkIn?: string;
  checkOut?: string;
  status: AttendanceRecord["status"];
  lateMinutes?: number;
  earlyLeaveMinutes?: number;
  note?: string;
};

const seeds: RecordSeed[] = [
  { personId: "demo-executive", checkIn: "08:52", checkOut: "18:06", status: "normal" },
  { personId: "demo-product-head", checkIn: "08:47", checkOut: "18:18", status: "normal" },
  { personId: "demo-engineer", checkIn: "09:09", checkOut: "18:20", status: "late", lateMinutes: 9 },
  { personId: "demo-qa", checkIn: "08:55", checkOut: "18:01", status: "normal" },
  { personId: "demo-market-head", checkIn: "09:14", checkOut: "18:03", status: "late", lateMinutes: 14, note: "客户现场返程遇早高峰" },
  { personId: "demo-design-head", checkIn: "08:58", checkOut: "17:22", status: "early_leave", earlyLeaveMinutes: 38, note: "外出客户沟通" },
  { personId: "demo-customer-head", checkIn: "08:51", checkOut: "17:58", status: "normal" },
  { personId: "demo-operations", status: "leave", note: "年假 · 已审批" },
  { personId: "demo-finance", checkIn: "08:59", checkOut: "18:08", status: "normal" },
  { personId: "demo-hr", checkIn: "08:54", checkOut: "18:12", status: "normal" },
];

const records: AttendanceRecord[] = seeds.map((seed, index) => {
  const person = getCustomerDemoPerson(seed.personId);
  const employeeItem = mockEmployees.find(({ profile }) => profile.id === person?.employeeProfileId);
  if (!employeeItem) throw new Error(`考勤演示人员未配置：${seed.personId}`);
  return {
    id: `71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    organizationId: CUSTOMER_DEMO_ORGANIZATION_ID,
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
      presentToday: records.filter(({ status }) => status !== "leave").length,
      lateToday: records.filter(({ status }) => status === "late").length,
      leaveToday: records.filter(({ status }) => status === "leave").length,
      monthlyAttendanceRate: 96.4,
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
