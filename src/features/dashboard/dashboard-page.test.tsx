import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { getDecisionStorageKey } from "@/features/decision-workbench/decision-workbench-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";

describe("DashboardPage", () => {
  beforeEach(() => {
    window.localStorage.removeItem(getDecisionStorageKey(createOperationFixtureContext(executiveWorkspaceSession))!);
  });

  it("shows the decision input and the simplified responsibility workflow", () => {
    render(<DashboardPage />);

    expect(screen.getByRole("heading", { name: "AI 决策调度台" })).toBeVisible();
    expect(screen.getByLabelText("战略问题或目标")).toBeVisible();
    expect(screen.getByRole("button", { name: "让 AI 拆解并分工" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "把一个决策，清楚地落到每个人头上" })).toBeVisible();
    expect(screen.getByText("拆成可执行任务")).toBeVisible();
    expect(screen.getByText("分到具体部门")).toBeVisible();
    expect(screen.getByText("落到唯一负责人")).toBeVisible();
    expect(screen.getByText("持续回流结果")).toBeVisible();
  });

  it("decomposes a decision and exposes department and personal responsibilities", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "让 AI 拆解并分工" }));

    expect(await screen.findByRole("heading", { name: "责任分工图" })).toBeVisible();
    expect(screen.getByText("决策推进办公室")).toBeVisible();
    expect(screen.getByText("产品研发中心")).toBeVisible();
    expect(screen.getByText("市场中心")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认方案并下发 13 项任务" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "查看任务详情：实现目标拆解与责任映射" })).toBeVisible();
  });
});
