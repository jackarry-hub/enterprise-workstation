import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { resetCustomerDemoState } from "@/features/demo/customer-demo-state";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { resetOperationsState, saveOperationsState } from "@/features/operations/operations-data";
import { ExecutiveClosurePanel } from "@/features/operations/executive-closure-panel";

const executiveSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-executive",
)!;

describe("ExecutiveClosurePanel customer demo", () => {
  beforeEach(() => window.localStorage.clear());

  it("explains exactly who must act before total acceptance is enabled", () => {
    render(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}>
        <ExecutiveClosurePanel />
      </WorkspaceSessionProvider>,
    );

    expect(screen.getByRole("button", { name: "提交总验收" })).toBeDisabled();
    expect(screen.getByText("还不能提交：陈晨需先完成“实现目标拆解与责任映射”并由张伟验收。")).toBeVisible();
    expect(screen.getByRole("region", { name: "真实业务闭环" })).toHaveAttribute("id", "customer-demo-closure");
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
    expect(screen.getByRole("button", { name: "提交总验收" })).toBeDisabled();
  });
});
