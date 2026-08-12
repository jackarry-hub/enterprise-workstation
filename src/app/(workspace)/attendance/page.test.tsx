import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/attendance/attendance-page", () => ({
  AttendancePage: () => <main>考勤审批、复核与封账</main>,
}));

import AttendanceRoute from "@/app/(workspace)/attendance/page";

describe("attendance route", () => {
  it("opens the operating workspace so attendance approvals can enter payroll", () => {
    render(<AttendanceRoute />);

    expect(screen.getByText("考勤审批、复核与封账")).toBeInTheDocument();
  });
});
