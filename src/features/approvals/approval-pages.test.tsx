import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { renderWithSpecificWorkspaceSession, unboundExecutiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import { ApprovalDetailPage } from "@/features/approvals/approval-detail-page";
import { ApprovalsPage } from "@/features/approvals/approvals-page";
import type { ApprovalResult } from "@/features/approvals/approval-types";

describe("approval pages", () => {
  it("does not expose fixture approvals to an unbound real identity", () => {
    renderWithSpecificWorkspaceSession(
      <ApprovalsPage result={approvalMockResult} />,
      unboundExecutiveWorkspaceSession,
    );

    expect(screen.getByText("当前账号没有可显示的真实审批数据。" )).toBeVisible();
    expect(screen.queryByText("王芳")).not.toBeInTheDocument();
    expect(screen.getByText("当前显示 0 条审批")).toBeVisible();
  });

  it("does not expose fixture approval detail to an unbound real identity", () => {
    renderWithSpecificWorkspaceSession(
      <ApprovalDetailPage approval={approvalMockResult.data.approvals[1]} />,
      unboundExecutiveWorkspaceSession,
    );

    expect(screen.getByRole("heading", { name: "审批数据暂不可用" })).toBeVisible();
    expect(screen.queryByText("报销申请")).not.toBeInTheDocument();
  });

  it("renders Supabase reimbursement approvals for a real identity", () => {
    const realApprovals: ApprovalResult = {
      source: "supabase",
      data: {
        approvals: [{
          id: "approval-real-1",
          code: "EXP-20260825-001",
          type: "reimbursement",
          title: "客户拜访差旅报账",
          summary: "差旅费 ¥1,260.00",
          applicant: { id: unboundExecutiveWorkspaceSession.member.employeeProfileId, displayName: "真实决策人", department: "总经办", jobTitle: "董事长" },
          owner: { id: "finance-profile", displayName: "赵敏", department: "财务部", jobTitle: "财务经理" },
          submittedAt: "2026-08-25 09:10",
          status: "pending",
          currentStep: "财务复核",
          priority: "high",
          initiatedByViewer: true,
          fields: [{ label: "报账金额", value: "¥1,260.00" }],
          steps: [],
          actions: [],
        }],
        stats: { pending: 1, initiated: 1, approved: 0, rejected: 0 },
      },
    };

    renderWithSpecificWorkspaceSession(
      <ApprovalsPage result={realApprovals} />,
      unboundExecutiveWorkspaceSession,
    );

    expect(screen.queryByText("当前账号没有可显示的真实审批数据。")).not.toBeInTheDocument();
    expect(screen.getByText("客户拜访差旅报账")).toBeVisible();
    expect(screen.getByText("真实数据库记录")).toBeVisible();
  });

  it("renders and filters the approval queue", async () => {
    const user = userEvent.setup();
    render(<ApprovalsPage result={approvalMockResult} />);

    expect(screen.getByRole("heading", { name: "审批中心" })).toBeVisible();
    const stats = screen.getByRole("region", { name: "审批统计" });
    expect(within(stats).getByText("待审批")).toBeVisible();
    expect(within(stats).getByText("我发起")).toBeVisible();
    expect(within(stats).getByText("已通过")).toBeVisible();
    expect(within(stats).getByText("已拒绝")).toBeVisible();

    await user.type(screen.getByRole("searchbox", { name: "搜索审批" }), "王芳");
    const list = screen.getByRole("region", { name: "审批列表" });
    expect(within(list).getAllByText("王芳").length).toBeGreaterThanOrEqual(1);
    expect(within(list).queryByText("张伟")).not.toBeInTheDocument();
  });

  it("shows fixed approval steps and completes an approve confirmation", async () => {
    const user = userEvent.setup();
    const approval = approvalMockResult.data.approvals[1];
    render(<ApprovalDetailPage approval={approval} />);

    expect(screen.getByRole("heading", { name: "报销申请" })).toBeVisible();
    expect(screen.getByRole("region", { name: "审批流程" })).toBeVisible();
    expect(screen.getByRole("region", { name: "审批记录" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "同意申请" }));
    expect(screen.getByRole("dialog", { name: "确认同意申请" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "确认同意" }));

    expect(screen.getByText("审批已通过")).toBeVisible();
  });
});
