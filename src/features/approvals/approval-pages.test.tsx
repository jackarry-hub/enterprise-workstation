import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import { ApprovalDetailPage } from "@/features/approvals/approval-detail-page";
import { ApprovalsPage } from "@/features/approvals/approvals-page";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { renderWithSpecificWorkspaceSession, unboundExecutiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const executive = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-executive")!;

describe("approval pages", () => {
  it("does not expose fixture approvals to an unbound real identity", () => {
    renderWithSpecificWorkspaceSession(<ApprovalsPage result={{ ...approvalMockResult, data: { ...approvalMockResult.data, approvals: [] } }} />, unboundExecutiveWorkspaceSession);
    expect(screen.getByText("这里暂时没有审批")).toBeVisible();
    expect(screen.queryByText("王芳")).not.toBeInTheDocument();
  });

  it("renders the two concise mobile approval queues", async () => {
    const user = userEvent.setup();
    renderWithSpecificWorkspaceSession(<ApprovalsPage result={approvalMockResult} />, executive);
    expect(screen.getByRole("heading", { name: "审批" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "待我审批" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByTestId("mobile-approval-row").length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByRole("tab", { name: "我发起的" }));
    expect(screen.getByRole("tab", { name: "我发起的" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows fixed approval steps and completes an approve confirmation", async () => {
    const user = userEvent.setup();
    renderWithSpecificWorkspaceSession(<ApprovalDetailPage approval={approvalMockResult.data.approvals[1]} />, executive);
    expect(screen.getByRole("heading", { name: "报销申请" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "同意申请" }));
    await user.click(screen.getByRole("button", { name: "确认同意" }));
    expect(screen.getByText("审批已通过")).toBeVisible();
  });

  it("keeps approval people and timing readable in the mobile summary", () => {
    renderWithSpecificWorkspaceSession(<ApprovalDetailPage approval={approvalMockResult.data.approvals[1]} />, executive);

    expect(screen.getByTestId("approval-people-summary")).toHaveAttribute("data-layout", "mobile-readable");
    expect(screen.getAllByTestId("approval-person-card")).toHaveLength(2);
    expect(screen.getByTestId("approval-submission-meta")).toBeVisible();
  });
});
