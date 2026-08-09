import { attendanceMockResult } from "@/features/attendance/attendance-mock-data";
import type { AttendanceResult } from "@/features/attendance/attendance-types";
import { AttendanceWorkspace } from "@/features/attendance/attendance-workspace";

export function AttendancePage({ result = attendanceMockResult }: { result?: AttendanceResult }) {
  return <AttendanceWorkspace result={result} />;
}
