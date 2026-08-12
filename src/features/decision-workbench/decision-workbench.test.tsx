import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { DecisionWorkbench } from "@/features/decision-workbench/decision-workbench";
import {
  createDecisionPlan,
  createDefaultDecisionInput,
  saveStoredDecision,
} from "@/features/decision-workbench/decision-workbench-data";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { CUSTOMER_DEMO_RESET_EVENT } from "@/features/demo/customer-demo-state";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { resetOperationsState, saveOperationsState } from "@/features/operations/operations-data";

const executiveSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-executive",
)!;

describe("DecisionWorkbench customer demo progress", () => {
  beforeEach(() => window.localStorage.clear());

  it("opens the customer demo on a ten-task zero-percent plan ready to dispatch", () => {
    render(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}>
        <DecisionWorkbench />
      </WorkspaceSessionProvider>,
    );

    const current = screen.getByRole("list", { name: "决策推进流程" }).querySelector('[aria-current="step"]');
    expect(current).toHaveTextContent("AI 拆解");
    expect(screen.getByRole("heading", { name: "责任分工图" })).toBeVisible();
    expect(screen.getByRole("button", { name: "确认方案并下发 10 项任务" })).toBeEnabled();
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
  });

  it("highlights summary and review after the shared command is archived", async () => {
    const context = createOperationFixtureContext(executiveSession);
    const initial = resetOperationsState(context);
    saveOperationsState(context, {
      ...initial,
      command: { ...initial.command, status: "archived" },
      tasks: initial.tasks.map((task) => ({ ...task, status: "done", progress: 100 })),
    });
    render(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}>
        <DecisionWorkbench />
      </WorkspaceSessionProvider>,
    );

    await waitFor(() => {
      const current = screen.getByRole("list", { name: "决策推进流程" }).querySelector('[aria-current="step"]');
      expect(current).toHaveTextContent("汇总复盘");
    });
  });

  it("keeps the CEO dispatch result focused on the shared project instead of personal tasks", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}>
        <DecisionWorkbench />
      </WorkspaceSessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "确认方案并下发 10 项任务" }));
    expect(await screen.findByRole("link", { name: "查看专项项目" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "查看个人任务" })).not.toBeInTheDocument();
  });

  it("clears a stale issued plan immediately when the customer demo is reset", async () => {
    const context = createOperationFixtureContext(executiveSession);
    const input = createDefaultDecisionInput();
    saveStoredDecision(context, {
      version: 1,
      stage: "issued",
      input,
      plan: createDecisionPlan(input),
    });

    render(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}>
        <DecisionWorkbench />
      </WorkspaceSessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "责任分工图" })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent(CUSTOMER_DEMO_RESET_EVENT));
    });

    expect(await screen.findByRole("button", { name: "确认方案并下发 10 项任务" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "责任分工图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发起新决策" })).toBeInTheDocument();
  });
});
