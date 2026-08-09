import type { AttendanceStatus } from "@/features/attendance/attendance-types";

export const attendanceStatusMeta: Record<AttendanceStatus, {
  label: string;
  tone: "active" | "success" | "warning" | "neutral";
}> = {
  normal: { label: "正常", tone: "success" },
  late: { label: "迟到", tone: "warning" },
  early_leave: { label: "早退", tone: "active" },
  leave: { label: "请假", tone: "neutral" },
};
