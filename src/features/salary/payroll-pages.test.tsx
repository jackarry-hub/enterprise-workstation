import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { renderWithSpecificWorkspaceSession, unboundExecutiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PayrollDetailPage } from "@/features/salary/payroll-detail-page";
import { PayrollPage } from "@/features/salary/payroll-page";
import { salaryMockResult } from "@/features/salary/salary-mock-data";
import type { SalaryResult } from "@/features/salary/salary-types";

describe("payroll pages", () => {
  it("does not expose fixture payroll to an unbound real identity", () => {
    renderWithSpecificWorkspaceSession(
      <PayrollPage result={salaryMockResult} />,
      unboundExecutiveWorkspaceSession,
    );

    expect(screen.getByText("当前账号没有可显示的真实薪资数据。" )).toBeVisible();
    expect(screen.queryByText("林远")).not.toBeInTheDocument();
  });

  it("renders Supabase payroll for a real identity instead of treating it as fixture data", () => {
    const realPayroll: SalaryResult = {
      source: "supabase",
      data: {
        departments: [{ id: "dept-real", name: "总经办" }],
        stats: { totalSalary: 31500, employeeCount: 1, averageSalary: 31500 },
        records: [{
          id: "real-payroll-1",
          employee: {
            id: unboundExecutiveWorkspaceSession.member.employeeProfileId,
            employeeNo: "QXY-CEO",
            displayName: "真实决策人",
            jobTitle: "董事长",
            salaryGradeCode: "M6",
            jobLevel: 6,
          },
          department: { id: "dept-real", name: "总经办" },
          month: "2026-08",
          baseSalary: 26000,
          bonus: 8500,
          deductions: 3000,
          netSalary: 31500,
          status: "paid",
          breakdown: [
            { label: "部门职级基础工资", amount: 26000, kind: "income" },
            { label: "项目奖金池分配", amount: 4800, kind: "income" },
            { label: "扣款", amount: 3000, kind: "deduction" },
          ],
          history: [{ month: "2026-08", netSalary: 31500, status: "paid" }],
        }],
      },
    };

    renderWithSpecificWorkspaceSession(
      <PayrollPage result={realPayroll} />,
      unboundExecutiveWorkspaceSession,
    );

    expect(screen.queryByText("当前账号没有可显示的真实薪资数据。")).not.toBeInTheDocument();
    expect(screen.getAllByText("真实决策人").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("M6 · L6")).toBeVisible();
  });

  it("does not expose fixture payslip detail to an unbound real identity", () => {
    renderWithSpecificWorkspaceSession(
      <PayrollDetailPage record={salaryMockResult.data.records[0]} />,
      unboundExecutiveWorkspaceSession,
    );

    expect(screen.getByRole("heading", { name: "薪资数据暂不可用" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "工资组成" })).not.toBeInTheDocument();
  });

  it("renders and filters the salary management list", async () => {
    const user = userEvent.setup();
    render(<PayrollPage result={salaryMockResult} />);

    expect(screen.getByRole("heading", { name: "薪资管理" })).toBeVisible();
    const stats = screen.getByRole("region", { name: "薪资统计" });
    expect(within(stats).getByText("本月工资总额")).toBeVisible();
    expect(within(stats).getByText("员工数量")).toBeVisible();
    expect(within(stats).getByText("平均工资")).toBeVisible();
    expect(within(stats).queryByText("+8.6%")).not.toBeInTheDocument();
    expect(within(stats).queryByText("+5.3%")).not.toBeInTheDocument();
    expect(within(stats).queryByText("较上月")).not.toBeInTheDocument();

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
