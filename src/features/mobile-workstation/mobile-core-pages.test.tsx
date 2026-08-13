import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { MobileApprovalsPage } from "@/features/mobile-workstation/mobile-approvals-page";
import { MobileProfilePage } from "@/features/mobile-workstation/mobile-profile-page";
import { MobileProjectsPage } from "@/features/mobile-workstation/mobile-projects-page";
import { getProjectListMock, mockProjectMilestoneReminders, mockProjectPortfolioStats } from "@/features/projects/mock-data";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const departmentHead = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-product-head")!;

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
    expect(screen.getByRole("link", { name: "我的考勤" })).toHaveAttribute("href", "/attendance");
    expect(screen.getByRole("link", { name: "我的工资" })).toHaveAttribute("href", "/payroll");
    expect(screen.getByRole("link", { name: "我的日报" })).toHaveAttribute("href", "/execution");
    expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeVisible();
  });
});
