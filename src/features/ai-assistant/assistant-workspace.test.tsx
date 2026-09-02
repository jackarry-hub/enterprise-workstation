import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantWorkspace } from "@/features/ai-assistant/assistant-workspace";

describe("AI assistant workspace", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("renders persisted conversation history and a mobile full-screen thread", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [{ id: "11111111-1111-4111-8111-111111111111", title: "真实周计划", version: 3, lastMessageAt: "2026-08-30T08:00:00Z" }] }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: "22222222-2222-4222-8222-222222222222", sequence: 1, role: "user", content: "生成本周计划", state: "completed", createdAt: "2026-08-30T08:00:00Z" }] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssistantWorkspace />);
    expect((await screen.findAllByText("真实周计划")).length).toBeGreaterThan(0);
    expect(await screen.findByText("生成本周计划")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回会话列表" }).closest("header")?.parentElement).toHaveClass("max-md:fixed");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("restores the remembered thread after refresh on mobile", async () => {
    const firstId = "11111111-1111-4111-8111-111111111111";
    const rememberedId = "33333333-3333-4333-8333-333333333333";
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [
        { id: firstId, title: "最新但未打开", version: 1, lastMessageAt: "2026-08-30T09:00:00Z", lastOpenedAt: null },
        { id: rememberedId, title: "上次工作会话", version: 2, lastMessageAt: "2026-08-30T08:00:00Z", lastOpenedAt: "2026-08-30T10:00:00Z" },
      ] }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: "44444444-4444-4444-8444-444444444444", sequence: 1, role: "assistant", content: "已恢复上下文", state: "completed", createdAt: "2026-08-30T08:00:00Z" }] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AssistantWorkspace />);

    expect(await screen.findByText("已恢复上下文")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/workstation/ai/conversations/${rememberedId}/messages`, { cache: "no-store" });
  });
});
