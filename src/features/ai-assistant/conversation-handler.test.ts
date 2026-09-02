import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { handleConversationCollection, handleConversationMessages, handleConversationResource, type ConversationDependencies } from "@/features/ai-assistant/conversation-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const conversationId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";

function deps(rpc: ReturnType<typeof vi.fn>, serviceRpc?: ReturnType<typeof vi.fn>): ConversationDependencies {
  return {
    loadSession: async () => executiveWorkspaceSession,
    rpc: rpc as unknown as ConversationDependencies["rpc"],
    serviceRpc: serviceRpc as unknown as ConversationDependencies["serviceRpc"],
    createRequestId: () => requestId,
  };
}

describe("persistent AI conversations", () => {
  it("keeps conversations owner-scoped with ordered messages and versioned archive", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202608300006_ai_conversations.sql"), "utf8").toLowerCase();
    expect(sql).toContain("ai_conversations_owner_select");
    expect(sql).toContain("unique (tenant_id,conversation_id,sequence)");
    expect(sql).toContain("response_to_message_id");
    expect(sql).toContain("conversation_busy");
    expect(sql).toContain("version_conflict");
  });

  it("uses the canonical audit target columns when creating an idempotent conversation", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202609020005_ai_conversation_audit_columns.sql"), "utf8").toLowerCase();
    expect(sql).toContain("audit.target_type = 'ai_conversation'");
    expect(sql).toContain("audit.target_id = conversation.public_id::text");
    expect(sql).not.toContain("audit.resource_type");
    expect(sql).not.toContain("audit.resource_id");
  });

  it("creates a conversation with an idempotency key", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { conversation: { id: conversationId, title: "周计划", version: 1 } }, error: null });
    const response = await handleConversationCollection(new Request("https://test/api", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ title: "周计划" }) }), deps(rpc));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_ai_conversation", expect.objectContaining({ p_idempotency_key: key }));
  });

  it("does not invoke the model twice when the message already has a response", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { conversationId, userMessageId: key, assistantMessageId: requestId, state: "completed" }, error: null });
    const invoke = vi.fn();
    const response = await handleConversationMessages(new Request("https://test/api", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ content: "生成计划" }) }), conversationId, { ...deps(rpc), invoke });
    expect(response.status).toBe(200);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("persists the user message before the model and stores the terminal assistant message", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { conversationId, userMessageId: key, assistantMessageId: null, state: "pending" }, error: null });
    const serviceRpc = vi.fn().mockResolvedValue({ data: { conversationId, userMessageId: key, assistantMessageId: requestId, state: "completed" }, error: null });
    const invoke = vi.fn().mockResolvedValue({ success: true, content: "已生成", errorCode: "" });
    const response = await handleConversationMessages(new Request("https://test/api", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ content: "生成计划" }) }), conversationId, { ...deps(rpc, serviceRpc), invoke });
    expect(response.status).toBe(201);
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0]);
    expect(serviceRpc).toHaveBeenCalledWith("complete_ai_assistant_message", expect.objectContaining({ p_actor_member_id: executiveWorkspaceSession.member.id, p_success: true }));
  });

  it("invokes the model with bounded persisted conversation history instead of only the latest question", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { conversationId, userMessageId: key, assistantMessageId: null, state: "pending" }, error: null })
      .mockResolvedValueOnce({ data: { items: [
        { id: "40000000-0000-4000-8000-000000000001", sequence: 1, role: "user", content: "项目截止日期是什么？", state: "completed" },
        { id: "40000000-0000-4000-8000-000000000002", sequence: 2, role: "assistant", content: "截止日期是 9 月 30 日。", state: "completed" },
        { id: key, sequence: 3, role: "user", content: "那还剩几天？", state: "completed" },
      ] }, error: null });
    const serviceRpc = vi.fn().mockResolvedValue({ data: { conversationId, userMessageId: key, assistantMessageId: requestId, state: "completed" }, error: null });
    const invoke = vi.fn().mockResolvedValue({ success: true, content: "还剩 28 天。", errorCode: "" });

    const response = await handleConversationMessages(
      new Request("https://test/api", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ content: "那还剩几天？" }) }),
      conversationId,
      { ...deps(rpc, serviceRpc), invoke },
    );

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenNthCalledWith(2, "list_current_ai_messages", {
      p_conversation_public_id: conversationId,
      p_limit: 40,
    });
    expect(invoke).toHaveBeenCalledWith([
      { role: "user", content: "项目截止日期是什么？" },
      { role: "assistant", content: "截止日期是 9 月 30 日。" },
      { role: "user", content: "那还剩几天？" },
    ], key);
  });

  it("rejects a stale archive version", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await handleConversationResource(new Request("https://test/api", { method: "DELETE", body: JSON.stringify({ expectedVersion: 2 }) }), conversationId, deps(rpc));
    expect(response.status).toBe(409);
  });

  it("persists the active thread server-side for refresh and re-login", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { conversationId, lastOpenedAt: "2026-09-02T02:00:00Z" }, error: null });
    const response = await handleConversationResource(new Request("https://test/api", { method: "PATCH" }), conversationId, deps(rpc));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("touch_current_ai_conversation", { p_conversation_public_id: conversationId });
  });
});
