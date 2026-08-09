import { describe, expect, it } from "vitest";

import { attendanceMockResult } from "@/features/attendance/attendance-mock-data";
import {
  filterAttendanceRecords,
  getAttendanceAnomalies,
} from "@/features/attendance/attendance-selectors";

describe("attendance selectors", () => {
  it("provides the approved V0.9 summary and monthly trend", () => {
    expect(attendanceMockResult.data.stats).toEqual({
      presentToday: 119,
      lateToday: 6,
      leaveToday: 3,
      monthlyAttendanceRate: 92.6,
    });
    expect(attendanceMockResult.data.trend).toHaveLength(8);
  });

  it("filters by employee keyword, department, date, and status", () => {
    const records = filterAttendanceRecords(attendanceMockResult.data.records, {
      query: "QXY-1002",
      departmentId: "all",
      date: "2026-08-04",
      status: "late",
    });

    expect(records).toHaveLength(1);
    expect(records[0].employee.displayName).toBe("王芳");
  });

  it("uses one attendance source for the anomaly reminder list", () => {
    const anomalies = getAttendanceAnomalies(attendanceMockResult.data.records);

    expect(anomalies.length).toBeGreaterThanOrEqual(3);
    expect(anomalies.every((record) => record.status !== "normal")).toBe(true);
    expect(new Set(anomalies.map((record) => record.id)).size).toBe(anomalies.length);
  });
});
