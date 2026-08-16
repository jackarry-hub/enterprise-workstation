import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { DecisionWorkbench } from "@/features/decision-workbench/decision-workbench";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";
import { validDispatchPlan } from "@/test/ai-dispatch-test-utils";

const departmentHead = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-product-head",
)!;

describe("DecisionWorkbench mobile structure", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps one goal field, four quick prompts and one primary generation action", () => {
    renderWithSpecificWorkspaceSession(<DecisionWorkbench />, departmentHead);

    expect(screen.getByTestId("mobile-ai-dispatch-surface")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "战略问题或目标" })).toBeVisible();
    for (const prompt of [
      "3天内完成移动端V1",
      "制定一周官网升级计划",
      "安排本周客户交付",
      "重新分配团队优先级",
    ]) {
      expect(screen.getByRole("button", { name: prompt })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "用 DeepSeek 生成任务计划" })).toBeVisible();
    expect(within(screen.getByRole("status", { name: "DeepSeek 接入状态" })).getByText("AI 调度已就绪")).toBeVisible();
  });

  it("uses the server-side DeepSeek dispatch endpoint to generate the review plan", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      plan: validDispatchPlan,
      model: "deepseek-v4-flash",
      repaired: false,
      mode: "demo",
      source: "deepseek",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithSpecificWorkspaceSession(<DecisionWorkbench />, departmentHead);

    await user.click(screen.getByRole("button", { name: "用 DeepSeek 生成任务计划" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/ai/dispatch", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("30 天完成星云智造量子智枢试点上线"),
    }));
    expect(await screen.findByRole("heading", { name: "DeepSeek 调度建议" })).toBeVisible();
    expect(within(screen.getByRole("status", { name: "DeepSeek 接入状态" })).getByText("当前模型：deepseek-v4-flash")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认方案并下发 3 项任务" })).toBeVisible();
  });

  it("labels the offline customer-demo fallback instead of presenting it as a DeepSeek result", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      plan: {
        ...validDispatchPlan,
        summary: "当前运行环境无法访问 DeepSeek，系统已用本地演示规则生成任务方案。",
      },
      model: "demo-fallback",
      repaired: false,
      mode: "demo",
      source: "demo_fallback",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    renderWithSpecificWorkspaceSession(<DecisionWorkbench />, departmentHead);

    await user.click(screen.getByRole("button", { name: "用 DeepSeek 生成任务计划" }));

    expect(await screen.findByRole("heading", { name: "本地演示调度建议" })).toBeVisible();
    expect(within(screen.getByRole("status", { name: "DeepSeek 接入状态" })).getByText("当前使用本地演示方案")).toBeVisible();
    expect(screen.getAllByText("离线演示").length).toBeGreaterThan(0);
  });

  it("runs the GitHub Pages AI demo locally without calling a server endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubEnv("NEXT_PUBLIC_STATIC_AI_DEMO", "true");
    vi.stubGlobal("fetch", fetchMock);
    renderWithSpecificWorkspaceSession(<DecisionWorkbench />, departmentHead);

    expect(within(screen.getByRole("status", { name: "DeepSeek 接入状态" })).getByText("当前使用本地演示方案")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "用 DeepSeek 生成任务计划" }));

    expect(await screen.findByRole("heading", { name: "本地演示调度建议" })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the current demo decision maker instead of a legacy name", () => {
    render(
      <WorkspaceSessionProvider session={departmentHead} demoSessions={customerDemoSessions}>
        <DecisionWorkbench />
      </WorkspaceSessionProvider>,
    );

    expect(screen.queryByText(/李总/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/张伟/).length).toBeGreaterThan(0);
  });
});
