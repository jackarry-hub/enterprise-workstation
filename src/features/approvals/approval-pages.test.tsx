import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import { ApprovalDetailPage } from "@/features/approvals/approval-detail-page";
import { ApprovalsPage } from "@/features/approvals/approvals-page";

describe("approval pages", () => {
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
