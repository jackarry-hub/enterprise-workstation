import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { MobileApprovalsPage } from "@/features/mobile-workstation/mobile-approvals-page";
import { MobileHomePage } from "@/features/mobile-workstation/mobile-home-page";
import { MobileProfilePage } from "@/features/mobile-workstation/mobile-profile-page";
import { MobileProjectsPage } from "@/features/mobile-workstation/mobile-projects-page";
import { MobileTasksPage } from "@/features/mobile-workstation/mobile-tasks-page";
import { MobileTeamPage } from "@/features/mobile-workstation/mobile-team-page";
import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { resetOperationsState, saveOperationsState } from "@/features/operations/operations-data";
import { getProjectListMock, mockProjectMilestoneReminders, mockProjectPortfolioStats } from "@/features/projects/mock-data";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const departmentHead = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-product-head")!;
const executive = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-executive")!;
const employee = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-engineer")!;

function renderDemoProfile(children: ReactNode = <MobileProfilePage />) {
  return render(
    <WorkspaceSessionProvider session={departmentHead} demoSessions={customerDemoSessions}>
      {children}
    </WorkspaceSessionProvider>,
  );
}

describe("mobile core pages", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows a manager identity, AI entry, dispatch progress and no attendance content", () => {
    renderWithSpecificWorkspaceSession(<MobileHomePage />, departmentHead);

    expect(screen.getByRole("img", { name: "张伟的AI演示头像" })).toBeVisible();
    expect(screen.getByText("张伟")).toBeVisible();
    expect(screen.getByText("产品技术总监 · 产品研发中心")).toBeVisible();
    expect(screen.getByText("执行中")).toBeVisible();
    expect(screen.getByRole("link", { name: "进入 AI 调度中心" })).toHaveAttribute("href", "/decision");
    expect(screen.getAllByTestId("mobile-priority").length).toBeLessThanOrEqual(3);
    expect(screen.queryByText(/考勤|打卡|迟到|早退/)).not.toBeInTheDocument();
  });

  it("gives an employee one personal task action without the AI dispatch entry", () => {
    renderWithSpecificWorkspaceSession(<MobileHomePage />, employee);

    expect(screen.queryByRole("link", { name: "进入 AI 调度中心" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续当前任务" })).toHaveAttribute("href", expect.stringContaining("/execution"));
    expect(screen.queryByText("CEO 专属")).not.toBeInTheDocument();
  });

  it("filters concise project cards by status and search", async () => {
    const user = userEvent.setup();
    renderWithSpecificWorkspaceSession(<MobileProjectsPage projects={getProjectListMock()} stats={mockProjectPortfolioStats} reminders={mockProjectMilestoneReminders} />, departmentHead);
    expect(screen.getByRole("heading", { name: "项目" })).toBeVisible();
    for (const tab of ["全部", "进行中", "已完成", "已暂停"]) expect(screen.getByRole("tab", { name: tab })).toBeVisible();
    expect(screen.getAllByTestId("mobile-project-card").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("tab", { name: "已完成" }));
    expect(screen.getByRole("tab", { name: "已完成" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByTestId("mobile-project-card").every((card) => card.textContent?.includes("已完成"))).toBe(true);
  });

  it("filters the current person's tasks through five status tabs", async () => {
    const user = userEvent.setup();
    renderWithSpecificWorkspaceSession(<MobileTasksPage />, employee);

    for (const tab of ["全部", "待开始", "进行中", "待验收", "已完成"]) expect(screen.getByRole("tab", { name: tab })).toBeVisible();
    expect(screen.getAllByTestId("mobile-task-card").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("mobile-task-card").length).toBeLessThanOrEqual(5);
    await user.click(screen.getByRole("tab", { name: "进行中" }));
    expect(screen.getByRole("tab", { name: "进行中" })).toHaveAttribute("aria-selected", "true");
    for (const card of screen.queryAllByTestId("mobile-task-card")) expect(card).toHaveTextContent("进行中");
  });

  it("keeps a manager's personal queue non-empty even when their real tasks are all initiated work", () => {
    renderWithSpecificWorkspaceSession(<MobileTasksPage />, departmentHead);

    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByTestId("mobile-task-card").length).toBeGreaterThan(0);
  });

  it("shows tasks awaiting the current viewer's review in my pending review list", async () => {
    const user = userEvent.setup();
    const executiveContext = createOperationFixtureContext(executive);
    const state = resetOperationsState(executiveContext);
    saveOperationsState(executiveContext, {
      ...state,
      tasks: state.tasks.map((task) => task.id === "dept-task-finance"
        ? { ...task, status: "review" as const, progress: 90 }
        : task),
    });

    renderWithSpecificWorkspaceSession(<MobileTasksPage />, executive);
    await user.click(screen.getByRole("tab", { name: "待验收" }));

    const reviewCard = screen.getByRole("link", { name: "直接办理：完成月度薪资核算" });
    expect(reviewCard).toBeVisible();
    expect(reviewCard).toHaveAttribute("href", "/execution#review-dept-task-finance");
    expect(reviewCard).toHaveTextContent("待验收");
  });

  it("renders the two approval queues and approval detail links", () => {
    renderWithSpecificWorkspaceSession(<MobileApprovalsPage result={approvalMockResult} />, executive);
    expect(screen.getByRole("heading", { name: "审批" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "待我审批" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "我发起的" })).toBeVisible();
    expect(screen.getAllByTestId("mobile-approval-row").length).toBeGreaterThanOrEqual(1);
  });

  it("shows a scoped team directory with useful member status", () => {
    renderWithSpecificWorkspaceSession(<MobileTeamPage result={employeeDirectoryMockResult} />, departmentHead);

    expect(screen.getByRole("heading", { name: "团队" })).toBeVisible();
    expect(screen.getAllByTestId("mobile-team-summary")).toHaveLength(3);
    expect(screen.getAllByTestId("mobile-member-row").length).toBeGreaterThan(0);
    expect(screen.getByText("张伟")).toBeVisible();
    expect(screen.getByText("陈晨")).toBeVisible();
    expect(screen.getAllByText("可接受任务").length).toBeGreaterThan(0);
  });

  it("shows personal destinations without attendance or daily-report entries", () => {
    renderWithSpecificWorkspaceSession(<MobileProfilePage />, departmentHead);
    expect(screen.getByRole("heading", { name: "我的" })).toBeVisible();
    expect(screen.getByText("张伟")).toBeVisible();
    expect(screen.getByRole("link", { name: "我的工资" })).toHaveAttribute("href", "/payroll");
    expect(screen.getByRole("link", { name: "我的项目" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "我的成果" })).toHaveAttribute("href", "/tasks?status=done");
    expect(screen.getByRole("link", { name: "通知" })).toHaveAttribute("href", "/notifications");
    expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("link", { name: "我的考勤" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "我的日报" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "张伟的AI演示头像" })).toBeVisible();
  });

  it("opens a mobile identity sheet containing all ten demo people", async () => {
    const user = userEvent.setup();
    renderDemoProfile();

    expect(screen.queryByRole("combobox", { name: "切换演示身份" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切换演示身份" }));

    expect(screen.getByRole("dialog", { name: "选择演示身份" })).toBeVisible();
    expect(screen.getAllByTestId("mobile-identity-option")).toHaveLength(10);
    expect(screen.getByRole("button", { name: /张伟.*产品技术总监/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /林远.*CEO/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /李琪.*HRBP/ })).toBeVisible();
  });

  it("switches identity and routes to that person landing page", async () => {
    const user = userEvent.setup();
    routerPush.mockClear();
    renderDemoProfile();

    await user.click(screen.getByRole("button", { name: "切换演示身份" }));
    await user.click(screen.getByRole("button", { name: /刘洋.*设计总监/ }));

    expect(window.localStorage.getItem("enterprise-workstation.customer-demo.actor.v1")).toBe("demo-design-head");
    expect(routerPush).toHaveBeenCalledWith("/dashboard");
  });
});
