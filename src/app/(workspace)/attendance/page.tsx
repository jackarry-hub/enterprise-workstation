import type { Metadata } from "next";

import { loadAttendance } from "@/features/attendance/attendance-data";
import { AttendancePage } from "@/features/attendance/attendance-page";

export const metadata: Metadata = {
  title: "考勤管理 | 企业工作站",
};

export default async function AttendanceRoute() {
  const result = await loadAttendance();
  return <AttendancePage result={result} />;
}
