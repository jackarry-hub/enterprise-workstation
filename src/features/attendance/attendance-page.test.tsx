import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { attendanceMockResult } from "@/features/attendance/attendance-mock-data";
import { AttendancePage } from "@/features/attendance/attendance-page";

describe("AttendancePage", () => {
  it("renders the complete attendance management surface", () => {
    render(<AttendancePage result={attendanceMockResult} />);

    expect(screen.getByRole("heading", { name: "考勤管理" })).toBeVisible();
    expect(screen.getByText("今日出勤人数")).toBeVisible();
    expect(screen.getByText("迟到人数")).toBeVisible();
    expect(screen.getByText("请假人数")).toBeVisible();
    expect(screen.getByText("本月出勤率")).toBeVisible();
    expect(screen.getByRole("region", { name: "考勤记录" })).toBeVisible();
    expect(screen.getByRole("region", { name: "月度出勤趋势" })).toBeVisible();
    expect(screen.getByRole("region", { name: "异常提醒" })).toBeVisible();
  });

  it("filters attendance records by employee and status", async () => {
    const user = userEvent.setup();
    render(<AttendancePage result={attendanceMockResult} />);

    await user.type(screen.getByRole("searchbox", { name: "搜索考勤员工" }), "王芳");
    await user.click(screen.getByRole("combobox", { name: "筛选考勤状态" }));
    await user.click(screen.getByRole("option", { name: "迟到" }));

    const records = screen.getByRole("region", { name: "考勤记录" });
    expect(within(records).getAllByText("王芳").length).toBeGreaterThanOrEqual(1);
    expect(within(records).queryByText("张伟")).not.toBeInTheDocument();
    expect(screen.getByText("当前显示 1 条考勤记录")).toBeVisible();
  });
});
