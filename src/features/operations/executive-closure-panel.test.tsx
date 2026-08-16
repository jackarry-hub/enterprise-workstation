import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { resetCustomerDemoState } from "@/features/demo/customer-demo-state";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { getTaskReviewerId, readOperationsState, resetOperationsState, saveOperationsState } from "@/features/operations/operations-data";
import { ExecutiveClosurePanel } from "@/features/operations/executive-closure-panel";

const executiveSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-executive",
)!;

describe("ExecutiveClosurePanel customer demo", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps department work visible while asking for a separate AI dispatch", () => {
    render(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}>
        <ExecutiveClosurePanel />
      </WorkspaceSessionProvider>,
    );

    expect(screen.queryByRole("button", { name: "提交总验收" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CEO 验收与归档" })).toBeVisible();
    expect(screen.getByText("待方案下发")).toBeVisible();
    expect(screen.getByText("请先在上方生成并确认 AI 调度方案；现有部门任务与进度会继续保留。")).toBeVisible();
    expect(screen.queryByRole("link", { name: "查看项目成果" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今日必须处理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "本周执行摘要" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "跨部门动态" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "真实业务闭环" })).toHaveAttribute("id", "customer-demo-closure");
  });

  it("shows one actionable CEO review and approves it in place", async () => {
    const user = userEvent.setup();
    const context = createOperationFixtureContext(executiveSession);
    const initial = resetOperationsState(context);
    const task = initial.tasks.find((item) => getTaskReviewerId(item) === "actor-executive")!;
    saveOperationsState(context, {
      ...initial,
      command: { ...initial.command, projectId: "demo-project" },
      tasks: initial.tasks.map((item) => item.id === task.id ? { ...item, status: "review", progress: 90 } : item),
      files: [{
        id: "executive-review-file",
        commandId: initial.command.id,
        entityType: "task",
        entityId: task.id,
        name: "成果说明.txt",
        mimeType: "text/plain",
        sizeBytes: 128,
        version: 1,
        uploadedById: task.assigneeId,
        provider: "indexeddb",
        objectPath: "demo/executive-review-file",
        createdAt: initial.command.createdAt,
      }],
    });
    render(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}>
        <ExecutiveClosurePanel />
      </WorkspaceSessionProvider>,
    );

    expect(screen.getAllByText(task.title)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: `通过验收：${task.title}` }));

    await waitFor(() => expect(readOperationsState(context).tasks.find(({ id }) => id === task.id)?.status).toBe("done"));
    expect(await screen.findByText("负责人任务已验收通过")).toBeVisible();
    expect(screen.queryByText(task.title)).not.toBeInTheDocument();
  });

  it("removes archived success feedback when the shared demo is reset", async () => {
    const user = userEvent.setup();
    const context = createOperationFixtureContext(executiveSession);
    const initial = resetOperationsState(context);
    saveOperationsState(context, {
      ...initial,
      command: { ...initial.command, status: "accepted" },
      tasks: initial.tasks.map((task) => ({ ...task, status: "done", progress: 100 })),
      supportRequests: initial.supportRequests.map((request) => ({ ...request, status: "completed" })),
    });
    render(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}>
        <ExecutiveClosurePanel />
      </WorkspaceSessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "完成归档" }));
    expect(await screen.findByText("命令成果已发布到知识库")).toBeVisible();

    act(() => resetCustomerDemoState());

    await waitFor(() => expect(screen.queryByText("命令成果已发布到知识库")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "提交总验收" })).not.toBeInTheDocument();
  });
});
