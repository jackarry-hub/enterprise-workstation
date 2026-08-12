import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { renderWithSpecificWorkspaceSession, unboundExecutiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { PayrollDetailPage } from "@/features/salary/payroll-detail-page";
import { PayrollPage } from "@/features/salary/payroll-page";
import { salaryMockResult } from "@/features/salary/salary-mock-data";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import {
  getOperationNotifications,
  lockAttendancePeriod,
  readOperationsState,
  resetOperationsState,
  saveOperationsState,
} from "@/features/operations/operations-data";

describe("payroll pages", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

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

  it("blocks a department head from opening another person's payslip directly", () => {
    const managerSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-product-head")!;
    renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={managerSession} demoSessions={customerDemoSessions}>
        <PayrollDetailPage record={salaryMockResult.data.records[0]} />
      </WorkspaceSessionProvider>,
      managerSession,
    );

    expect(screen.getByRole("heading", { name: "无权查看此工资单" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "工资组成" })).not.toBeInTheDocument();
  });

  it("shows department heads only their own payslip instead of the company payroll list", () => {
    const managerSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-product-head")!;
    renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={managerSession} demoSessions={customerDemoSessions}>
        <PayrollPage result={salaryMockResult} />
      </WorkspaceSessionProvider>,
      managerSession,
    );

    const list = screen.getByRole("region", { name: "工资列表" });
    expect(within(list).getAllByText("张伟").length).toBeGreaterThan(0);
    expect(within(list).queryByText("林远")).not.toBeInTheDocument();
    expect(screen.getByText(/仅展示 张伟 本人的工资记录/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "本月发放准备" })).not.toBeInTheDocument();
  });

  it("keeps the internal payroll preparation workflow off an employee's payslip page", () => {
    const employeeSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-engineer")!;
    renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={employeeSession} demoSessions={customerDemoSessions}>
        <PayrollPage result={salaryMockResult} />
      </WorkspaceSessionProvider>,
      employeeSession,
    );

    expect(screen.getByText(/仅展示 陈晨 本人的工资记录/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "本月发放准备" })).not.toBeInTheDocument();
    expect(screen.queryByText("0 个节点待处理")).not.toBeInTheDocument();
  });

  it("keeps the progress summary informational and exposes only the current handling entry", () => {
    const financeSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-finance")!;
    renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={financeSession} demoSessions={customerDemoSessions}>
        <PayrollPage result={salaryMockResult} />
      </WorkspaceSessionProvider>,
      financeSession,
    );

    expect(screen.getByText("当前责任节点：李琪（人事）· 考勤封账")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "薪资发放进度" })).getByText("0%")).toBeVisible();
    expect(screen.queryByRole("link", { name: "等待人事封账" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /处理考勤封账|处理薪资核算/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole("complementary")).getAllByText("待处理")).toHaveLength(5);
  });

  it("lets HR start the customer payroll demo at zero by completing attendance close", () => {
    const hrSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-hr")!;
    renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={hrSession} demoSessions={customerDemoSessions}>
        <PayrollPage result={salaryMockResult} />
      </WorkspaceSessionProvider>,
      hrSession,
    );

    expect(screen.getByRole("link", { name: "去完成考勤封账" })).toHaveAttribute("href", "/attendance#monthly-close");
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
    expect(screen.getByRole("status")).toHaveTextContent("已通知全员查看工资单");

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

  it("runs the visible payroll controls from 20% to 100% across the responsible roles", async () => {
    const user = userEvent.setup();
    const financeSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-finance")!;
    const hrSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-hr")!;
    const executiveSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-executive")!;
    const context = createOperationFixtureContext(financeSession);
    const hrContext = createOperationFixtureContext(hrSession);
    resetOperationsState(context);
    lockAttendancePeriod(hrContext, "actor-hr");

    let view = renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={financeSession} demoSessions={customerDemoSessions}><PayrollPage result={salaryMockResult} /></WorkspaceSessionProvider>,
      financeSession,
    );
    expect(within(screen.getByRole("region", { name: "薪资发放进度" })).getByText("20%")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "完成薪资核算并生成工资单" }));
    expect(within(screen.getByRole("region", { name: "薪资发放进度" })).getByText("40%")).toBeVisible();
    view.unmount();

    view = renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={hrSession} demoSessions={customerDemoSessions}><PayrollPage result={salaryMockResult} /></WorkspaceSessionProvider>,
      hrSession,
    );
    await user.click(screen.getByRole("button", { name: "完成人员、考勤与工资单复核" }));
    expect(within(screen.getByRole("region", { name: "薪资发放进度" })).getByText("60%")).toBeVisible();
    view.unmount();

    view = renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}><PayrollPage result={salaryMockResult} /></WorkspaceSessionProvider>,
      executiveSession,
    );
    await user.click(screen.getByRole("button", { name: "批准本月薪资发放" }));
    expect(within(screen.getByRole("region", { name: "薪资发放进度" })).getByText("80%")).toBeVisible();
    view.unmount();

    renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={financeSession} demoSessions={customerDemoSessions}><PayrollPage result={salaryMockResult} /></WorkspaceSessionProvider>,
      financeSession,
    );
    await user.click(screen.getByRole("button", { name: "确认银行发放并归档凭证" }));
    expect(within(screen.getByRole("region", { name: "薪资发放进度" })).getByText("100%")).toBeVisible();
    expect(getOperationNotifications(readOperationsState(context), "actor-employee")).toContainEqual(expect.objectContaining({
      title: "2026年08月工资已发放",
      href: "/payroll",
    }));
  });

  it("keeps completed payroll milestones in place instead of linking back to attendance", () => {
    const financeSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-finance")!;
    const context = createOperationFixtureContext(financeSession);
    const initial = resetOperationsState(context);
    saveOperationsState(context, {
      ...initial,
      payrollRun: { ...initial.payrollRun, status: "paid", attendanceLocked: true, exceptionCount: 0, paidAt: "2026-08-25T02:00:00.000Z" },
    });

    renderWithSpecificWorkspaceSession(
      <WorkspaceSessionProvider session={financeSession} demoSessions={customerDemoSessions}>
        <PayrollPage result={salaryMockResult} />
      </WorkspaceSessionProvider>,
      financeSession,
    );

    expect(screen.queryByRole("link", { name: "处理考勤封账" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看考勤封账" })).not.toBeInTheDocument();
    expect(screen.getByText("本月发薪流程已闭环")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "薪资发放进度" })).getByText("100%")).toBeVisible();
    expect(within(screen.getByRole("complementary")).getAllByText("已完成")).toHaveLength(5);
  });
});
