import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";

describe("DashboardPage", () => {
  it("shows the selected action-first mobile home structure", () => {
    const executive = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-executive")!;
    renderWithSpecificWorkspaceSession(<DashboardPage />, executive);
    expect(screen.getByRole("heading", { name: "企业工作站" })).toBeVisible();
    expect(screen.getByText(/早上好/)).toBeVisible();
    expect(screen.getByRole("link", { name: /待办任务/ })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("link", { name: /进行中项目/ })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: /待审批/ })).toHaveAttribute("href", "/approvals?queue=pending");
    expect(screen.getByRole("link", { name: /今日考勤/ })).toHaveAttribute("href", "/attendance");
    expect(screen.getByRole("heading", { name: "今日重点" })).toBeVisible();
    expect(screen.getAllByTestId("mobile-priority")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "查看全部待办" })).toHaveAttribute("href", "/tasks");
  });
});
