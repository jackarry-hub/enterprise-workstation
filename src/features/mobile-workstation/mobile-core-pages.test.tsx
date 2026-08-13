import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { MobileApprovalsPage } from "@/features/mobile-workstation/mobile-approvals-page";
import { MobileProfilePage } from "@/features/mobile-workstation/mobile-profile-page";
import { MobileProjectsPage } from "@/features/mobile-workstation/mobile-projects-page";
import { getProjectListMock, mockProjectMilestoneReminders, mockProjectPortfolioStats } from "@/features/projects/mock-data";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const departmentHead = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-product-head")!;

function renderDemoProfile(children: ReactNode = <MobileProfilePage />) {
  return render(
    <WorkspaceSessionProvider session={departmentHead} demoSessions={customerDemoSessions}>
      {children}
    </WorkspaceSessionProvider>,
  );
}

describe("mobile core pages", () => {
  it("renders concise project cards with working detail destinations", () => {
    renderWithSpecificWorkspaceSession(<MobileProjectsPage projects={getProjectListMock()} stats={mockProjectPortfolioStats} reminders={mockProjectMilestoneReminders} />, departmentHead);
    expect(screen.getByRole("heading", { name: "项目" })).toBeVisible();
    expect(screen.getAllByTestId("mobile-project-card").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the two approval queues and approval detail links", () => {
    renderWithSpecificWorkspaceSession(<MobileApprovalsPage result={approvalMockResult} />, departmentHead);
    expect(screen.getByRole("heading", { name: "审批" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "待我审批" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "我发起的" })).toBeVisible();
    expect(screen.getAllByTestId("mobile-approval-row").length).toBeGreaterThanOrEqual(1);
  });

  it("shows personal destinations including the current person's payslip", () => {
    renderWithSpecificWorkspaceSession(<MobileProfilePage />, departmentHead);
    expect(screen.getByRole("heading", { name: "我的" })).toBeVisible();
    expect(screen.getByText("张伟")).toBeVisible();
    expect(screen.getByRole("link", { name: "我的考勤" })).toHaveAttribute("href", "/attendance?view=self");
    expect(screen.getByRole("link", { name: "我的工资" })).toHaveAttribute("href", "/payroll");
    expect(screen.getByRole("link", { name: "我的日报" })).toHaveAttribute("href", "/execution");
    expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeVisible();
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
    expect(routerPush).toHaveBeenCalledWith("/department");
  });
});
