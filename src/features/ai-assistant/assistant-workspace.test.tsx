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
});
