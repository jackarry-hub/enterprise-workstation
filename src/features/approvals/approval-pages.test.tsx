import { screen, waitFor, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { renderWithSpecificWorkspaceSession, unboundExecutiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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
      <ApprovalDetailPage approval={approvalMockResult.data.approvals[0]} dataSource="mock" />,
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
          version: 1,
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
          actionableByViewer: false,
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

  it("shows a service failure instead of healthy zero statistics", () => {
    renderWithSpecificWorkspaceSession(
      <ApprovalsPage result={{
        source: "supabase",
        data: {
          approvals: [],
          stats: { pending: 0, initiated: 0, approved: 0, rejected: 0 },
          loadError: "审批数据库暂时不可用",
        },
      }} />,
      unboundExecutiveWorkspaceSession,
    );

    expect(screen.getByText("审批数据库暂时不可用")).toBeVisible();
    expect(screen.queryByRole("region", { name: "审批统计" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "审批列表" })).not.toBeInTheDocument();
  });

  it("keeps an RLS-visible supervisor approval instead of filtering it as an employee", async () => {
    const user = userEvent.setup();
    const supervisor = {
      ...unboundExecutiveWorkspaceSession,
      roleCodes: ["supervisor" as const],
      primaryRole: "employee" as const,
      permissionCodes: ["approval.act" as const],
      actor: { ...unboundExecutiveWorkspaceSession.actor, role: "employee" as const },
    };
    const approval = {
      ...approvalMockResult.data.approvals[1],
      owner: { ...approvalMockResult.data.approvals[1].owner, id: supervisor.member.employeeProfileId },
      actionableByViewer: true,
    };
    renderWithSpecificWorkspaceSession(
      <ApprovalsPage result={{
        source: "supabase",
        data: { approvals: [approval], stats: { pending: 1, initiated: 0, approved: 0, rejected: 0 } },
      }} />,
      supervisor,
    );

    await user.click(screen.getByRole("tab", { name: "待我审批" }));
    expect(screen.getByText(approval.title)).toBeVisible();
  });

  it("renders and filters the approval queue", async () => {
    const user = userEvent.setup();
    render(<ApprovalsPage result={{ ...approvalMockResult, source: "supabase" }} />);

    expect(screen.getByRole("heading", { name: "审批中心" })).toBeVisible();
    const stats = screen.getByRole("region", { name: "审批统计" });
    expect(within(stats).getByText("待审批")).toBeVisible();
    expect(within(stats).getByText("我发起")).toBeVisible();
    expect(within(stats).getByText("已通过")).toBeVisible();
    expect(within(stats).getByText("未通过")).toBeVisible();

    await user.type(screen.getByRole("searchbox", { name: "搜索审批" }), "王芳");
    const list = screen.getByRole("region", { name: "审批列表" });
    expect(within(list).getAllByText("王芳").length).toBeGreaterThanOrEqual(1);
    expect(within(list).queryByText("张伟")).not.toBeInTheDocument();
  });

  it("rejects fixture approval detail instead of rendering business data", () => {
    const approval = approvalMockResult.data.approvals[0];
    render(<ApprovalDetailPage approval={approval} dataSource="mock" />);

    expect(screen.getByRole("heading", { name: "审批数据暂不可用" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "同意申请" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝申请" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("审批已通过")).not.toBeInTheDocument();
  });

  it("lets only the current real approver submit a version-bound decision and reloads server state", async () => {
    const user = userEvent.setup();
    const currentApprover = {
      ...unboundExecutiveWorkspaceSession,
      member: { ...unboundExecutiveWorkspaceSession.member, employeeProfileId: "50000000-0000-4000-8000-000000000001" },
      permissionCodes: ["approval.act" as const],
    };
    const approval = {
      ...approvalMockResult.data.approvals[0],
      id: "40000000-0000-4000-8000-000000000001",
      version: 3,
      owner: { ...approvalMockResult.data.approvals[0].owner, id: currentApprover.member.employeeProfileId },
      status: "pending" as const,
    };
    const act = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      outcome: "success", resource: "approval", approval: { id: approval.id, version: 4, status: "approved" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const reload = vi.fn();

    renderWithSpecificWorkspaceSession(
      <ApprovalDetailPage approval={approval} dataSource="supabase" actionTransport={act} onReload={reload} />,
      currentApprover,
    );
    await user.click(screen.getByRole("button", { name: "同意申请" }));
    await user.click(screen.getByRole("button", { name: "确认同意" }));

    await waitFor(() => expect(act).toHaveBeenCalledWith(expect.objectContaining({
      approvalId: approval.id, version: 3, command: "approve",
    })));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("审批已通过")).not.toBeInTheDocument();
  });

  it("maps an optimistic decision conflict to an explicit refresh-required state", async () => {
    const user = userEvent.setup();
    const currentApprover = {
      ...unboundExecutiveWorkspaceSession,
      member: { ...unboundExecutiveWorkspaceSession.member, employeeProfileId: "50000000-0000-4000-8000-000000000001" },
      permissionCodes: ["approval.act" as const],
    };
    const approval = {
      ...approvalMockResult.data.approvals[0], id: "40000000-0000-4000-8000-000000000001",
      version: 3, owner: { ...approvalMockResult.data.approvals[0].owner, id: currentApprover.member.employeeProfileId },
      status: "pending" as const,
    };
    const act = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "conflict" }), {
      status: 409, headers: { "Content-Type": "application/json" },
    }));

    renderWithSpecificWorkspaceSession(
      <ApprovalDetailPage approval={approval} dataSource="supabase" actionTransport={act} />,
      currentApprover,
    );
    await user.click(screen.getByRole("button", { name: "同意申请" }));
    await user.click(screen.getByRole("button", { name: "确认同意" }));

    expect(await screen.findByText("审批状态已变化，请刷新后重试。")).toBeVisible();
    expect(screen.queryByText("审批已通过")).not.toBeInTheDocument();
  });

  it("does not render decision controls for an unrelated real employee", () => {
    const approval = {
      ...approvalMockResult.data.approvals[0], version: 3,
      owner: { ...approvalMockResult.data.approvals[0].owner, id: "50000000-0000-4000-8000-000000000099" },
      status: "pending" as const,
    };
    const employee = {
      ...unboundExecutiveWorkspaceSession,
      permissionCodes: ["approval.act" as const],
    };
    renderWithSpecificWorkspaceSession(
      <ApprovalDetailPage approval={approval} dataSource="supabase" />,
      employee,
    );

    expect(screen.queryByRole("button", { name: "同意申请" })).not.toBeInTheDocument();
    expect(screen.getByText("当前审批由指定负责人处理，你可以查看流程进度。")).toBeVisible();
  });

  it("does not render decision controls when the current owner lacks approval.act", () => {
    const ownerWithoutPermission = {
      ...unboundExecutiveWorkspaceSession,
      member: { ...unboundExecutiveWorkspaceSession.member, employeeProfileId: "50000000-0000-4000-8000-000000000001" },
      permissionCodes: [],
    };
    const approval = {
      ...approvalMockResult.data.approvals[0],
      owner: { ...approvalMockResult.data.approvals[0].owner, id: ownerWithoutPermission.member.employeeProfileId },
      status: "pending" as const,
    };
    renderWithSpecificWorkspaceSession(
      <ApprovalDetailPage approval={approval} dataSource="supabase" />,
      ownerWithoutPermission,
    );

    expect(screen.queryByRole("button", { name: "同意申请" })).not.toBeInTheDocument();
    expect(screen.getByText("当前审批由指定负责人处理，你可以查看流程进度。")).toBeVisible();
  });

  it("lets finance register payment against the server expense version and reloads", async () => {
    const user = userEvent.setup();
    const finance = {
      ...unboundExecutiveWorkspaceSession,
      permissionCodes: ["expense.manage" as const],
    };
    const approval = {
      ...approvalMockResult.data.approvals[0],
      id: "40000000-0000-4000-8000-000000000001",
      version: 5,
      status: "approved" as const,
      expense: {
        id: "60000000-0000-4000-8000-000000000001",
        version: 4,
        status: "approved" as const,
      },
    };
    const pay = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      outcome: "success", resource: "expense", expense: { id: approval.expense.id, version: 5, status: "paid" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const reload = vi.fn();

    renderWithSpecificWorkspaceSession(
      <ApprovalDetailPage approval={approval} dataSource="supabase" paymentTransport={pay} onReload={reload} />,
      finance,
    );
    await user.click(screen.getByRole("button", { name: "登记付款" }));
    await user.type(screen.getByLabelText("付款凭证号"), "BANK-20260828-001");
    await user.click(screen.getByRole("button", { name: "确认付款" }));

    await waitFor(() => expect(pay).toHaveBeenCalledWith(expect.objectContaining({
      expenseId: approval.expense.id,
      version: 4,
      paymentReference: "BANK-20260828-001",
    })));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("费用已付款")).not.toBeInTheDocument();
  });

  it("renders an approval comment as read-only comment history instead of a rejection", () => {
    const approval = {
      ...approvalMockResult.data.approvals[0],
      actions: [{
        ...approvalMockResult.data.approvals[0].actions[0],
        id: "approval-comment",
        actionType: "comment" as const,
        content: "请补充本次采购的合同编号。",
      }],
    };

    render(<ApprovalDetailPage approval={approval} dataSource="supabase" />);

    expect(screen.getByText("王芳 · 审批备注")).toBeVisible();
    expect(screen.getByText("请补充本次采购的合同编号。")).toBeVisible();
    expect(screen.queryByText("王芳 · 拒绝申请")).not.toBeInTheDocument();
  });
});
