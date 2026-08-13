import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";

const executive = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-executive")!;
const departmentHead = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-product-head")!;

describe("DashboardPage", () => {
  it("shows the selected action-first mobile home structure", () => {
    renderWithSpecificWorkspaceSession(<DashboardPage />, executive);
    expect(screen.getByRole("heading", { name: "企业工作站" })).toBeVisible();
    expect(screen.getByText(/早上好/)).toBeVisible();
    expect(screen.getByRole("link", { name: /待办任务/ })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("link", { name: /进行中项目/ })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: /待审批/ })).toHaveAttribute("href", "/approvals?queue=pending");
    expect(screen.getByRole("link", { name: /今日考勤/ })).toHaveAttribute("href", "/attendance?view=self");
    expect(screen.getByRole("heading", { name: "今日重点" })).toBeVisible();
    expect(screen.getAllByTestId("mobile-priority")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "查看全部待办" })).toHaveAttribute("href", "/tasks");
  });

  it("keeps the AI decision workbench as the executive's prominent mobile action", () => {
    renderWithSpecificWorkspaceSession(<DashboardPage />, executive);
    expect(screen.getByRole("link", { name: "进入 AI 决策调度台" })).toHaveAttribute("href", "/decision");
  });

  it("does not show the executive decision entry to other roles", () => {
    renderWithSpecificWorkspaceSession(<DashboardPage />, departmentHead);
    expect(screen.queryByRole("link", { name: "进入 AI 决策调度台" })).not.toBeInTheDocument();
  });

  it("routes each overview card to a page that matches its subject", () => {
    renderWithSpecificWorkspaceSession(<DashboardPage />, departmentHead);

    expect(screen.getByRole("link", { name: /待办任务/ })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("link", { name: /进行中项目/ })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: /待审批/ })).toHaveAttribute("href", "/approvals?queue=pending");
    expect(screen.getByRole("link", { name: /今日考勤/ })).toHaveAttribute("href", "/attendance?view=self");
  });
});
