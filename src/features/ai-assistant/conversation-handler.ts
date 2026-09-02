import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
type InvocationResult = { success: boolean; content: string; errorCode: string };
export type ConversationPromptMessage = { role: "user" | "assistant"; content: string };

export type ConversationDependencies = {
  loadSession: () => Promise<WorkspaceSession | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  serviceRpc?: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  invoke?: (messages: readonly ConversationPromptMessage[], idempotencyKey: string) => Promise<InvocationResult>;
  createRequestId?: () => string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function body(request: Request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 65_536) return null;
  try { return record(JSON.parse(raw)); } catch { return null; }
}

function statusFor(error: { code?: string } | null) {
  return error?.code === "42501" ? 403 : error?.code === "P0002" ? 404 : error?.code === "23505" || error?.code === "40001" || error?.code === "55000" ? 409 : error?.code === "22023" ? 422 : 503;
}

function errorFor(status: number) {
  return status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 409 ? "conflict" : status === 422 ? "invalid_request" : "ai_conversation_unavailable";
}

const PROMPT_HISTORY_LIMIT = 40;
const PROMPT_HISTORY_CHARACTER_LIMIT = 48_000;

function conversationPromptMessages(value: unknown, latestContent: string): ConversationPromptMessage[] {
  const items = record(value)?.items;
  const candidates = Array.isArray(items) ? items.flatMap((item) => {
    const message = record(item);
    const role = message?.role;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    const state = message?.state;
    if ((role !== "user" && role !== "assistant") || !content || content.length > 12_000) return [];
    if (role === "assistant" && state !== "completed") return [];
    return [{ role, content } satisfies ConversationPromptMessage];
  }) : [];

  if (!candidates.length || candidates.at(-1)?.role !== "user" || candidates.at(-1)?.content !== latestContent) {
    candidates.push({ role: "user", content: latestContent });
  }

  const bounded: ConversationPromptMessage[] = [];
  let usedCharacters = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (usedCharacters + candidate.content.length > PROMPT_HISTORY_CHARACTER_LIMIT && bounded.length > 0) break;
    bounded.push(candidate);
    usedCharacters += candidate.content.length;
  }
  return bounded.reverse();
}

async function defaults(): Promise<ConversationDependencies> {
  const client = await getSupabaseServerClient();
  return {
    loadSession: getWorkspaceSession,
    rpc: async (name, args) => await client.rpc(name, args) as RpcResult,
    serviceRpc: async (name, args) => await getSupabaseServiceRoleClient().rpc(name, args) as RpcResult,
  };
}

export async function handleConversationCollection(request: Request, provided?: ConversationDependencies) {
  const deps = provided ?? await defaults();
  const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (request.method === "GET") {
    const result = await deps.rpc("list_current_ai_conversations", { p_limit: 50 });
    if (result.error) return json({ error: errorFor(statusFor(result.error)) }, statusFor(result.error));
    return json(record(result.data) ?? { items: [] });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const value = await body(request);
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  const key = request.headers.get("idempotency-key")?.toLowerCase();
  if (!title || title.length > 120 || !key || !UUID_PATTERN.test(key)) return json({ error: "invalid_request" }, 400);
  const requestId = deps.createRequestId?.() ?? randomUUID();
  const result = await deps.rpc("create_ai_conversation", { p_title: title, p_idempotency_key: key, p_request_id: requestId });
  if (result.error) return json({ error: errorFor(statusFor(result.error)), requestId }, statusFor(result.error));
  return json({ ...record(result.data), requestId }, 201);
}

export async function handleConversationResource(request: Request, conversationId: string, provided?: ConversationDependencies) {
  if (!UUID_PATTERN.test(conversationId)) return json({ error: "not_found" }, 404);
  const deps = provided ?? await defaults();
  const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (request.method === "PATCH") {
    const result = await deps.rpc("touch_current_ai_conversation", {
      p_conversation_public_id: conversationId,
    });
    if (result.error) return json({ error: errorFor(statusFor(result.error)) }, statusFor(result.error));
    return json(record(result.data) ?? { conversationId });
  }
  if (request.method !== "DELETE") return json({ error: "method_not_allowed" }, 405);
  const value = await body(request);
  const expectedVersion = Number(value?.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return json({ error: "invalid_request" }, 400);
  const requestId = deps.createRequestId?.() ?? randomUUID();
  const result = await deps.rpc("archive_ai_conversation", { p_conversation_public_id: conversationId, p_expected_version: expectedVersion, p_request_id: requestId });
  if (result.error) return json({ error: errorFor(statusFor(result.error)), requestId }, statusFor(result.error));
  return json({ ...record(result.data), requestId });
}

export async function handleConversationMessages(request: Request, conversationId: string, provided?: ConversationDependencies) {
  if (!UUID_PATTERN.test(conversationId)) return json({ error: "not_found" }, 404);
  const deps = provided ?? await defaults();
  const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (request.method === "GET") {
    const result = await deps.rpc("list_current_ai_messages", { p_conversation_public_id: conversationId, p_limit: 200 });
    if (result.error) return json({ error: errorFor(statusFor(result.error)) }, statusFor(result.error));
    return json(record(result.data) ?? { items: [] });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const value = await body(request);
  const content = typeof value?.content === "string" ? value.content.trim() : "";
  const key = request.headers.get("idempotency-key")?.toLowerCase();
  if (!content || content.length > 12_000 || !key || !UUID_PATTERN.test(key)) return json({ error: "invalid_request" }, 400);
  const requestId = deps.createRequestId?.() ?? randomUUID();
  const started = await deps.rpc("append_ai_user_message", { p_conversation_public_id: conversationId, p_content: content, p_idempotency_key: key, p_request_id: requestId });
  if (started.error) return json({ error: errorFor(statusFor(started.error)), requestId }, statusFor(started.error));
  const receipt = record(started.data);
  if (!receipt || typeof receipt.userMessageId !== "string") return json({ error: "ai_conversation_unavailable", requestId }, 503);
  if (typeof receipt.assistantMessageId === "string") return json({ ...receipt, requestId });

  let promptMessages: ConversationPromptMessage[] = [{ role: "user", content }];
  try {
    const history = await deps.rpc("list_current_ai_messages", {
      p_conversation_public_id: conversationId,
      p_limit: PROMPT_HISTORY_LIMIT,
    });
    if (!history.error) promptMessages = conversationPromptMessages(history.data, content);
  } catch {
    // The newest message is already durable; a history read failure degrades to
    // a single-turn prompt rather than losing or duplicating the user message.
  }

  let invocation: InvocationResult;
  try {
    invocation = deps.invoke ? await deps.invoke(promptMessages, key) : { success: false, content: "AI 服务暂时不可用，请稍后重试。", errorCode: "ai_provider_unavailable" };
  } catch {
    invocation = { success: false, content: "AI 服务暂时不可用，请稍后重试。", errorCode: "ai_provider_unavailable" };
  }
  const serviceRpc = deps.serviceRpc;
  if (!serviceRpc) return json({ error: "ai_conversation_unavailable", requestId }, 503);
  const completed = await serviceRpc("complete_ai_assistant_message", {
    p_tenant_public_id: session.tenantId,
    p_organization_public_id: session.organization.id,
    p_actor_member_id: session.member.id,
    p_auth_user_id: session.authUserId,
    p_conversation_public_id: conversationId,
    p_user_message_public_id: receipt.userMessageId,
    p_content: invocation.content,
    p_success: invocation.success,
    p_error_code: invocation.errorCode,
    p_request_id: requestId,
  });
  if (completed.error) return json({ error: "ai_conversation_unavailable", requestId }, 503);
  return json({ ...record(completed.data), requestId, ...(invocation.success ? {} : { error: invocation.errorCode }) }, invocation.success ? 201 : 502);
}
