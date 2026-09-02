import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExternalWorkflowWorkspace } from "@/features/agents/external-workflow-workspace";

const workflow = {
  code: "digital-human-talking-video",
  name: "数字人口播视频",
  description: "真实口播工作流",
  category: "内容生产",
  provider: "content-workbench",
  providerLabel: "前端内容工作台",
  launchUrl: "https://content.quantumgalaxy.top/tasks/new?workflow=digital-human-talking-video",
  fields: [{ key: "input", label: "任务目标", type: "textarea", required: true }],
  connectionStatus: "unconfigured",
  nativeRunEnabled: false,
};

describe("external workflow workspace", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the exact workflow and refuses to fake a native run without a service connection", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [workflow] }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock); const user = userEvent.setup(); render(<ExternalWorkflowWorkspace />);
    await user.click(await screen.findByRole("button", { name: /数字人口播视频/ }));
    expect(screen.getByText("服务端连接待配置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即运行" })).toBeDisabled();
    expect(screen.getByRole("link", { name: /打开原中控台/ })).toHaveAttribute("href", workflow.launchUrl);
  });

  it("submits a connected workflow and reloads its durable history", async () => {
    const connected = { ...workflow, connectionStatus: "ready", nativeRunEnabled: true };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [connected] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ run: { id: "run-1", status: "succeeded", outputSummary: "已提交到内容工作台" } }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: "run-1", status: "succeeded", outputSummary: "已提交到内容工作台" }] }));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    const user = userEvent.setup(); render(<ExternalWorkflowWorkspace />);
    await user.click(await screen.findByRole("button", { name: /数字人口播视频/ }));
    await user.type(screen.getByLabelText("工作流任务目标"), "生成一条新品发布口播");
    await user.click(screen.getByRole("button", { name: "立即运行" }));
    expect((await screen.findAllByText("已提交到内容工作台")).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/workstation/agent-workflows/digital-human-talking-video/runs", expect.objectContaining({ method: "POST" }));
  });
});
