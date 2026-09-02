import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  loadWorkspaceData: vi.fn(),
}));

vi.mock("@/features/tasks/workspace-data", () => ({
  loadWorkspaceData: dependencies.loadWorkspaceData,
}));

vi.mock("@/features/tasks/workspace-page", () => ({
  WorkspacePage: ({ result }: { result: { data: { viewerName: string; todos: unknown[] } } }) => (
    <div>个人执行台：{result.data.viewerName}，待办 {result.data.todos.length}</div>
  ),
}));

import ExecutionWorkbenchPage from "@/app/(workspace)/execution/page";

describe("personal execution route", () => {
  it("loads the signed-in member's persisted task and approval inbox", async () => {
    dependencies.loadWorkspaceData.mockResolvedValue({
      source: "supabase",
      data: { viewerName: "员工甲", todos: [{ id: "task-1" }, { id: "approval-1" }] },
    });

    render(await ExecutionWorkbenchPage());

    expect(dependencies.loadWorkspaceData).toHaveBeenCalledOnce();
    expect(screen.getByText("个人执行台：员工甲，待办 2")).toBeVisible();
  });
});
