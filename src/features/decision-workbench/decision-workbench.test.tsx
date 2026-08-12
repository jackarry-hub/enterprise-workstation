import { act, render, screen, waitFor } from "@testing-library/react";
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

  it("highlights collaborative execution when the shared command is executing", () => {
    render(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}>
        <DecisionWorkbench />
      </WorkspaceSessionProvider>,
    );

    const current = screen.getByRole("list", { name: "决策推进流程" }).querySelector('[aria-current="step"]');
    expect(current).toHaveTextContent("协同执行");
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

    expect(await screen.findByRole("button", { name: "让 AI 拆解并分工" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "责任分工图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发起新决策" })).not.toBeInTheDocument();
  });
});
