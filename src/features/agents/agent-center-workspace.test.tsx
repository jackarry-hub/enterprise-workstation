import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCenterWorkspace } from "@/features/agents/agent-center-workspace";
import { executiveWorkspaceSession, renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";

const agentId = "11111111-1111-4111-8111-111111111111";

describe("Agent Center workspace", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a truthful empty state without demo Agents or manager actions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [], canManage: false })));
    renderWithSpecificWorkspaceSession(<AgentCenterWorkspace />, { ...executiveWorkspaceSession, permissionCodes: [] });
    expect((await screen.findAllByText("尚未创建 Agent")).length).toBeGreaterThan(0);
    expect(screen.queryByText("项目调度 Agent")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建 Agent" })).not.toBeInTheDocument();
  });

  it("renders a server Agent and its durable run for a manager", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [{ id: agentId, code: "legal_review", name: "法务审核", description: "审查合同风险", icon: "bot", status: "enabled", currentVersionId: "22222222-2222-4222-8222-222222222222", revision: 2, lifecycle: "published", modelCode: "deepseek-chat", promptVersion: "v2", tools: [{ code: "knowledge.search", highRisk: false }], canManage: true, canInvoke: true }], canManage: true }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: "33333333-3333-4333-8333-333333333333", requestId: "44444444-4444-4444-8444-444444444444", status: "succeeded", outputSummary: "审查完成", inputTokens: 30, outputTokens: 20, latencyMs: 800, completedAt: "2026-08-30T08:00:00Z" }] }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithSpecificWorkspaceSession(<AgentCenterWorkspace />, { ...executiveWorkspaceSession, permissionCodes: ["agent.manage"] });
    expect((await screen.findAllByText("法务审核")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "新建 Agent" })).toBeInTheDocument();
    expect(await screen.findByText("审查完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回 Agent 列表" }).closest("header")?.parentElement).toHaveClass("max-md:fixed");
  });

  it("installs the reviewed starter pack and reloads the real directory", async () => {
    const installedAgent = { id: agentId, code: "task_breakdown", name: "任务拆解 Agent", description: "任务拆解", icon: "check", status: "enabled", currentVersionId: "22222222-2222-4222-8222-222222222222", revision: 1, lifecycle: "published", modelCode: "deepseek-chat", promptVersion: "starter-v1", tools: [], canManage: true, canInvoke: true };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [], canManage: true }))
      .mockResolvedValueOnce(Response.json({ status: "ready", installed: 3, available: 3 }))
      .mockResolvedValueOnce(Response.json({ items: [installedAgent], canManage: true }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithSpecificWorkspaceSession(<AgentCenterWorkspace />, { ...executiveWorkspaceSession, permissionCodes: ["agent.manage"] });

    await screen.findByText("尚未创建 Agent");
    await user.click(screen.getByRole("button", { name: "安装标准套件" }));

    expect(await screen.findByText("已安装并发布 3 个标准 Agent；可进入“流程编排”按顺序组合。")).toBeInTheDocument();
    expect((await screen.findAllByText("任务拆解 Agent")).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/workstation/agents/starter-pack", expect.objectContaining({ method: "POST" }));
  });
});
