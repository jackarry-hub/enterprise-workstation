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

  it("rejects a stale archive version", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await handleConversationResource(new Request("https://test/api", { method: "DELETE", body: JSON.stringify({ expectedVersion: 2 }) }), conversationId, deps(rpc));
    expect(response.status).toBe(409);
  });
});
