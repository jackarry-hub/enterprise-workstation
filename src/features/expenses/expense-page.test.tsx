import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExpenseDialog } from "@/features/expenses/expense-dialog";
import { renderWithSpecificWorkspaceSession, unboundExecutiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const options = {
  source: "supabase" as const,
  drafts: [],
  projects: [{
    id: "20000000-0000-4000-8000-000000000001",
    code: "PRJ-001",
    name: "客户交付项目",
    receipts: [{
      id: "30000000-0000-4000-8000-000000000001",
      name: "高铁电子发票.pdf",
      mimeType: "application/pdf",
      sizeBytes: 204800,
    }],
  }],
};

const expenseSession = {
  ...unboundExecutiveWorkspaceSession,
  permissionCodes: ["expense.submit" as const],
};

describe("real expense submission UI", () => {
  it("creates a server draft, submits it for approval, then reloads instead of inventing local success", async () => {
    const user = userEvent.setup();
    const createDraft = vi.fn().mockResolvedValue({
      ok: true as const,
      expense: { id: "40000000-0000-4000-8000-000000000001", version: 1, status: "draft" as const },
    });
    const submitDraft = vi.fn().mockResolvedValue({
      ok: true as const,
      expense: { id: "40000000-0000-4000-8000-000000000001", version: 2, status: "submitted" as const },
    });
    const reload = vi.fn();

    renderWithSpecificWorkspaceSession(
      <ExpenseDialog open options={options} onOpenChange={vi.fn()} transport={{ createDraft, submitDraft }} onReload={reload} />,
      expenseSession,
    );
    const dialog = screen.getByRole("dialog", { name: "发起费用报销" });
    expect(dialog).toHaveClass("max-sm:h-[100dvh]");
    await user.selectOptions(screen.getByLabelText("关联项目"), options.projects[0].id);
    await user.type(screen.getByLabelText("报销金额"), "1280.50");
    await user.type(screen.getByLabelText("费用日期"), "2026-08-28");
    await user.type(screen.getByLabelText("费用说明"), "客户现场差旅");
    await user.click(screen.getByRole("checkbox", { name: /高铁电子发票/ }));
    await user.click(screen.getByRole("button", { name: "提交报销" }));

    await waitFor(() => expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({
      projectId: options.projects[0].id,
      amount: "1280.50",
      receiptFileIds: [options.projects[0].receipts[0].id],
    }), expect.any(String)));
    expect(submitDraft).toHaveBeenCalledWith("40000000-0000-4000-8000-000000000001", 1, expect.any(String));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("报销审批已完成")).not.toBeInTheDocument();
  });

  it("keeps a persisted draft visible and requests refresh when submission conflicts", async () => {
    const user = userEvent.setup();
    const createDraft = vi.fn().mockResolvedValue({
      ok: true as const,
      expense: { id: "40000000-0000-4000-8000-000000000001", version: 1, status: "draft" as const },
    });
    const submitDraft = vi.fn().mockResolvedValue({ ok: false as const, status: 409, error: "conflict" });

    renderWithSpecificWorkspaceSession(
      <ExpenseDialog open options={{ source: "supabase", projects: [], drafts: [] }} onOpenChange={vi.fn()} transport={{ createDraft, submitDraft }} />,
      expenseSession,
    );
    await user.type(screen.getByLabelText("报销金额"), "88.20");
    await user.type(screen.getByLabelText("费用日期"), "2026-08-28");
    await user.type(screen.getByLabelText("费用说明"), "办公耗材");
    await user.click(screen.getByRole("button", { name: "提交报销" }));

    expect(await screen.findByText("费用状态已变化，草稿已保留，请刷新后继续。")).toBeVisible();
    expect(screen.getByText("草稿已保存，尚未进入审批流程")).toBeVisible();
  });

  it("recovers a server draft after refresh and submits it without creating another draft", async () => {
    const user = userEvent.setup();
    const createDraft = vi.fn();
    const submitDraft = vi.fn().mockResolvedValue({
      ok: true as const,
      expense: { id: "40000000-0000-4000-8000-000000000001", version: 3, status: "submitted" as const },
    });
    const reload = vi.fn();
    const drafts = [{
      id: "40000000-0000-4000-8000-000000000001",
      version: 2,
      projectId: null,
      expenseType: "office" as const,
      amount: "88.20",
      expenseDate: "2026-08-28",
      description: "办公耗材",
      receiptFileIds: [],
      updatedAt: "2026-08-28T08:00:00Z",
    }];

    renderWithSpecificWorkspaceSession(
      <ExpenseDialog open options={{ source: "supabase", projects: [], drafts }} onOpenChange={vi.fn()} transport={{ createDraft, submitDraft }} onReload={reload} />,
      expenseSession,
    );
    await user.click(screen.getByRole("button", { name: "继续提交" }));
    expect(screen.getByDisplayValue("办公耗材")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重新提交" }));

    await waitFor(() => expect(submitDraft).toHaveBeenCalledWith(
      drafts[0].id,
      2,
      expect.any(String),
    ));
    expect(createDraft).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reuses the same create idempotency key after an uncertain network failure", async () => {
    const user = userEvent.setup();
    const createDraft = vi.fn()
      .mockRejectedValueOnce(new Error("network interrupted"))
      .mockResolvedValueOnce({
        ok: true as const,
        expense: { id: "40000000-0000-4000-8000-000000000001", version: 1, status: "draft" as const },
      });
    const submitDraft = vi.fn().mockResolvedValue({
      ok: true as const,
      expense: { id: "40000000-0000-4000-8000-000000000001", version: 2, status: "submitted" as const },
    });

    renderWithSpecificWorkspaceSession(
      <ExpenseDialog open options={{ source: "supabase", projects: [], drafts: [] }} onOpenChange={vi.fn()} transport={{ createDraft, submitDraft }} />,
      expenseSession,
    );
    await user.type(screen.getByLabelText("报销金额"), "60.00");
    await user.type(screen.getByLabelText("费用日期"), "2026-08-28");
    await user.type(screen.getByLabelText("费用说明"), "客户交通");
    await user.click(screen.getByRole("button", { name: "提交报销" }));
    expect(await screen.findByText("报销服务暂不可用，请稍后重试。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "提交报销" }));

    await waitFor(() => expect(createDraft).toHaveBeenCalledTimes(2));
    expect(createDraft.mock.calls[0][1]).toBe(createDraft.mock.calls[1][1]);
    expect(submitDraft).toHaveBeenCalledTimes(1);
  });
});
