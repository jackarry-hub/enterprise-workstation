import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PayrollDetailPage } from "@/features/salary/payroll-detail-page";
import { PayrollPage } from "@/features/salary/payroll-page";
import { salaryMockResult } from "@/features/salary/salary-mock-data";

describe("payroll pages", () => {
  it("renders and filters the salary management list", async () => {
    const user = userEvent.setup();
    render(<PayrollPage result={salaryMockResult} />);

    expect(screen.getByRole("heading", { name: "薪资管理" })).toBeVisible();
    const stats = screen.getByRole("region", { name: "薪资统计" });
    expect(within(stats).getByText("本月工资总额")).toBeVisible();
    expect(within(stats).getByText("员工数量")).toBeVisible();
    expect(within(stats).getByText("平均工资")).toBeVisible();

    await user.type(screen.getByRole("searchbox", { name: "搜索工资员工" }), "QXY-1002");
    const list = screen.getByRole("region", { name: "工资列表" });
    expect(within(list).getAllByText("王芳").length).toBeGreaterThanOrEqual(1);
    expect(within(list).queryByText("张伟")).not.toBeInTheDocument();
  });

  it("presents salary composition and monthly history", () => {
    const record = salaryMockResult.data.records[0];
    render(<PayrollDetailPage record={record} />);

    expect(screen.getByRole("heading", { name: `${record.employee.displayName}的工资单` })).toBeVisible();
    expect(screen.getByRole("region", { name: "工资组成" })).toBeVisible();
    expect(screen.getByRole("region", { name: "历史记录" })).toBeVisible();
  });
});
