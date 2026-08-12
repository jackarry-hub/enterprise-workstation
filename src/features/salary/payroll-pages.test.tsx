import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { renderWithSpecificWorkspaceSession, unboundExecutiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PayrollDetailPage } from "@/features/salary/payroll-detail-page";
import { PayrollPage } from "@/features/salary/payroll-page";
import { salaryMockResult } from "@/features/salary/salary-mock-data";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { resetOperationsState, saveOperationsState } from "@/features/operations/operations-data";

describe("payroll pages", () => {
  it("does not expose fixture payroll to an unbound real identity", () => {
    renderWithSpecificWorkspaceSession(
      <PayrollPage result={salaryMockResult} />,
      unboundExecutiveWorkspaceSession,
    );

    expect(screen.getByText("当前账号没有可显示的真实薪资数据。" )).toBeVisible();
    expect(screen.queryByText("林远")).not.toBeInTheDocument();
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

    await user.type(screen.getByRole("searchbox", { name: "搜索工资员工" }), "QXY-1005");
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

  it("turns pending payroll nodes into direct handling links", () => {
    const financeSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-finance")!;
    renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={financeSession} demoSessions={customerDemoSessions}>
        <PayrollPage result={salaryMockResult} />
      </WorkspaceSessionProvider>,
      financeSession,
    );

    expect(screen.getByRole("link", { name: "处理考勤封账" })).toHaveAttribute("href", "/attendance#monthly-close");
    expect(screen.getByRole("link", { name: "处理薪资核算" })).toHaveAttribute("href", "#payroll-control");
  });

  it("lets finance complete the pending bank payment from payroll and payslip pages", async () => {
    const user = userEvent.setup();
    const financeSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-finance")!;
    const context = createOperationFixtureContext(financeSession);
    const initial = resetOperationsState(context);
    saveOperationsState(context, {
      ...initial,
      payrollRun: { ...initial.payrollRun, status: "approved", attendanceLocked: true, exceptionCount: 0 },
    });

    const page = (
      <WorkspaceSessionProvider session={financeSession} demoSessions={customerDemoSessions}>
        <PayrollPage result={salaryMockResult} />
      </WorkspaceSessionProvider>
    );
    renderWithSpecificWorkspaceSession(page, financeSession);
    await user.click(screen.getByRole("button", { name: "确认银行发放并归档凭证" }));
    expect((await screen.findAllByText("已发放")).length).toBeGreaterThan(0);

    saveOperationsState(context, {
      ...initial,
      payrollRun: { ...initial.payrollRun, status: "approved", attendanceLocked: true, exceptionCount: 0 },
    });
    renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={financeSession} demoSessions={customerDemoSessions}>
        <PayrollDetailPage record={salaryMockResult.data.records[0]} />
      </WorkspaceSessionProvider>,
      financeSession,
    );
    expect(screen.getAllByRole("button", { name: "确认银行发放并归档凭证" }).length).toBeGreaterThan(0);
  });
});
