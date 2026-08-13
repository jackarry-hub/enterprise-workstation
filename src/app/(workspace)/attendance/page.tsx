import { Suspense } from "react";

import { AttendancePage } from "@/features/attendance/attendance-page";

export default function AttendanceRoute() {
  return <Suspense fallback={null}><AttendancePage /></Suspense>;
}
