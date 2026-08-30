import { randomUUID } from "node:crypto";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import type { AiConfigStore } from "@/features/ai-config/ai-config-store";
import { isAllowedAiModel } from "@/features/ai-config/ai-config-types";
import { decryptApiKey } from "@/features/ai-config/ai-secret-crypto";
import type { AuthorizedAgent } from "@/features/agents/authorize-agent-invocation";
import type { AiRuntimeStore } from "@/features/ai-runtime/rate-limit-store";

type AiChatDeps = {
  session: WorkspaceSession | null;
  store: Pick<AiConfigStore, "get">;
  encryptionKey: Uint8Array;
  fetchImpl?: typeof fetch;
  consumeRateLimit?: (key: string) => boolean | Promise<boolean>;
  runtime?: Pick<AiRuntimeStore, "consume" | "start" | "finalize">;
  authorizeAgentInvocation?: (agentPublicId: string) => Promise<AuthorizedAgent>;
  startAgentInvocation?: (payload: AgentInvocationStartPayload) => Promise<AgentInvocationHandle>;
  finalizeAgentInvocation?: (payload: AgentInvocationFinalizationPayload) => Promise<void>;
};

export type AgentInvocationStartPayload = {
  agentPublicId: string;
  actorMemberId: number;
  modelCode: string;
  promptVersion: string;
  status: "running";
  inputSummary: string;
  startedAt: string;
  authorizedAgent: AuthorizedAgent;
};

export type AgentInvocationHandle = { invocationId: string };

export type AgentInvocationFinalizationPayload = {
  invocationId: string;
  status: "succeeded" | "failed";
  outputSummary: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  errorCode: string;
  completedAt: string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type JsonRecord = Record<string, unknown>;
type ParseChatRequestResult = Awaited<ReturnType<typeof parseChatRequest>>;
type ParsedChatRequest = Extract<ParseChatRequestResult, { messages: ChatMessage[] }>;

const limits = new Map<string, { count: number; resetAt: number }>();

export async function handleAiChat(request: Request, deps: AiChatDeps) {
  const session = deps.session;
  if (!session) return json({ error: "unauthorized" }, 401);

  if (!deps.runtime) {
    const limitKey = `${session.tenantId}:${session.authUserId}`;
    const consume = deps.consumeRateLimit ?? consumeProcessRateLimit;
    if (!await consume(limitKey)) return json({ error: "rate_limited" }, 429);
  }

  const parsed = await parseChatRequest(request);
  if ("error" in parsed) return json({ error: parsed.error }, parsed.status);

  let authorizedAgent: AuthorizedAgent | null = null;
  if (parsed.agentPublicId) {
    if (!deps.authorizeAgentInvocation) {
      return json({ error: "agent_authorization_unavailable" }, 500);
    }
    try {
      authorizedAgent = await deps.authorizeAgentInvocation(parsed.agentPublicId);
    } catch (error) {
      const code = authorizationErrorCode(error);
      return json({ error: code }, code === "agent_not_found" ? 404 : 403);
    }
  }

  const config = await deps.store.get(session.tenantId);
  if (!config?.encrypted_api_key || !config.api_key_iv) {
    return json({ error: "ai_not_configured" }, 409);
  }
  if (!authorizedAgent && !isAllowedAiModel(config.model_name)) {
    return json({ error: "invalid_server_config" }, 500);
  }

  let apiKey: string;
  try {
    apiKey = await decryptApiKey(
      {
        ciphertext: config.encrypted_api_key,
        iv: config.api_key_iv,
      },
      deps.encryptionKey,
    );
  } catch {
    return json({ error: "invalid_server_config" }, 500);
  }

  const startedAt = Date.now();
  const modelCode = authorizedAgent?.model ?? config.model_name;
  const providerMessages = authorizedAgent
    ? [
      { role: "system" as const, content: authorizedAgent.systemPrompt },
      ...parsed.messages.filter((message) => message.role !== "system"),
    ]
    : parsed.messages;
  const suppliedRequestId = request.headers.get("idempotency-key");
  if (suppliedRequestId && !validPublicUuid(suppliedRequestId)) {
    return json({ error: "invalid_idempotency_key" }, 400);
  }
  const runtimeRequestId = suppliedRequestId?.toLowerCase() ?? randomUUID();
  let runtimeInvocation: { invocationId: string } | null = null;
  if (deps.runtime) {
    try {
      runtimeInvocation = await deps.runtime.start(
        runtimeRequestId,
        parsed.agentPublicId ? "agent.chat" : "assistant.chat",
        modelCode,
        new Date(startedAt).toISOString(),
      );
      const rate = await deps.runtime.consume(
        parsed.agentPublicId ? "agent.chat" : "assistant.chat",
        runtimeRequestId,
      );
      if (!rate.allowed) {
        await deps.runtime.finalize(runtimeInvocation.invocationId, "rate_limited", { inputTokens: 0, outputTokens: 0 }, "rate_limited", new Date().toISOString());
        return json({ error: "rate_limited" }, 429);
      }
    } catch {
      if (runtimeInvocation) {
        try {
          await deps.runtime.finalize(runtimeInvocation.invocationId, "failed", { inputTokens: 0, outputTokens: 0 }, "ai_runtime_unavailable", new Date().toISOString());
        } catch { /* stale running rows are recovered by the runtime worker */ }
      }
      return json({ error: "ai_runtime_unavailable" }, 503);
    }
  }
  const invocation = await startAgentInvocation(
    deps,
    session,
    parsed,
    modelCode,
    authorizedAgent,
    startedAt,
  );
  if (parsed.agentPublicId && !invocation) {
    await finalizeRuntimeInvocation(deps, runtimeInvocation, startedAt, {
      status: "failed", usage: { inputTokens: 0, outputTokens: 0 }, errorCode: "agent_invocation_start_failed",
    });
    return json({ error: "agent_invocation_start_failed" }, 500);
  }
  try {
    const upstreamBody = JSON.stringify({
      model: modelCode,
      messages: providerMessages,
      max_tokens: parsed.maxTokens,
      ...(parsed.structuredOutput
        ? {
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
        }
        : {}),
    });
    const attemptLimit = parsed.structuredOutput ? 2 : 1;
    for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
      const upstream = await (deps.fetchImpl ?? fetch)(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: upstreamBody,
          signal: AbortSignal.timeout(45_000),
        },
      );

      if (upstream.status === 401 || upstream.status === 403) {
        const recorded = await finalizeInvocations(deps, invocation, runtimeInvocation, startedAt, {
          status: "failed",
          outputSummary: "",
          latencyMs: Date.now() - startedAt,
          errorCode: "upstream_auth_failed",
        });
        if (!recorded) return json({ error: "agent_invocation_finalize_failed" }, 500);
        return json({ error: "upstream_auth_failed" }, 502);
      }
      if (!upstream.ok) {
        const recorded = await finalizeInvocations(deps, invocation, runtimeInvocation, startedAt, {
          status: "failed",
          outputSummary: "",
          latencyMs: Date.now() - startedAt,
          errorCode: "upstream_failed",
        });
        if (!recorded) return json({ error: "agent_invocation_finalize_failed" }, 500);
        return json({ error: "upstream_failed" }, 502);
      }

      let data: unknown;
      try {
        data = await upstream.json();
      } catch {
        if (attempt + 1 < attemptLimit) continue;
        const recorded = await finalizeInvocations(deps, invocation, runtimeInvocation, startedAt, {
          status: "failed",
          outputSummary: "",
          latencyMs: Date.now() - startedAt,
          errorCode: "upstream_invalid_response",
        });
        if (!recorded) return json({ error: "agent_invocation_finalize_failed" }, 500);
        return json({ error: "upstream_invalid_response" }, 502);
      }
      if (!parsed.structuredOutput || isValidStructuredResponse(data)) {
        const recorded = await finalizeInvocations(deps, invocation, runtimeInvocation, startedAt, {
          status: "succeeded",
          outputSummary: outputSummary(data),
          usage: usage(data),
          latencyMs: Date.now() - startedAt,
          errorCode: "",
        });
        if (!recorded) return json({ error: "agent_invocation_finalize_failed" }, 500);
        return json(data);
      }
    }
    const recorded = await finalizeInvocations(deps, invocation, runtimeInvocation, startedAt, {
      status: "failed",
      outputSummary: "",
      latencyMs: Date.now() - startedAt,
      errorCode: "upstream_invalid_response",
    });
    if (!recorded) return json({ error: "agent_invocation_finalize_failed" }, 500);
    return json({ error: "upstream_invalid_response" }, 502);
  } catch (error) {
    if (
      error instanceof DOMException
      && (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      const recorded = await finalizeInvocations(deps, invocation, runtimeInvocation, startedAt, {
        status: "failed", outputSummary: "", latencyMs: Date.now() - startedAt,
        errorCode: "upstream_timeout",
      });
      if (!recorded) return json({ error: "agent_invocation_finalize_failed" }, 500);
      return json({ error: "upstream_timeout" }, 504);
    }
    const recorded = await finalizeInvocations(deps, invocation, runtimeInvocation, startedAt, {
      status: "failed", outputSummary: "", latencyMs: Date.now() - startedAt,
      errorCode: "upstream_unavailable",
    });
    if (!recorded) return json({ error: "agent_invocation_finalize_failed" }, 500);
    return json({ error: "upstream_unavailable" }, 502);
  }
}

async function parseChatRequest(request: Request): Promise<
  | {
      error: string;
      status: number;
      messages?: never;
      maxTokens?: never;
      structuredOutput?: never;
      agentPublicId?: never;
    }
  | {
      messages: ChatMessage[];
      maxTokens: number;
      structuredOutput: boolean;
      agentPublicId: string | null;
      error?: never;
      status?: never;
    }
> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 65_536) {
    return { error: "request_too_large", status: 413 };
  }

  let body: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { error: "invalid_request", status: 400 };
    }
    body = value as Record<string, unknown>;
  } catch {
    return { error: "invalid_request", status: 400 };
  }

  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 30) {
    return { error: "invalid_messages", status: 400 };
  }
  const messages: ChatMessage[] = [];
  if (body.system !== undefined) {
    if (!validText(body.system)) return { error: "invalid_system", status: 400 };
    messages.push({ role: "system", content: body.system });
  }
  for (const item of body.messages) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { error: "invalid_messages", status: 400 };
    }
    const candidate = item as Record<string, unknown>;
    if (
      !["system", "user", "assistant"].includes(String(candidate.role))
      || !validText(candidate.content)
    ) {
      return { error: "invalid_messages", status: 400 };
    }
    messages.push({
      role: candidate.role as ChatMessage["role"],
      content: candidate.content,
    });
  }

  const maxTokens = body.max_tokens === undefined ? 1_000 : Number(body.max_tokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4_000) {
    return { error: "invalid_max_tokens", status: 400 };
  }
  if (body.structured_output !== undefined && typeof body.structured_output !== "boolean") {
    return { error: "invalid_structured_output", status: 400 };
  }
  if (body.agent_public_id !== undefined && !validPublicUuid(body.agent_public_id)) {
    return { error: "invalid_agent", status: 400 };
  }
  return {
    messages,
    maxTokens,
    structuredOutput: body.structured_output === true,
    agentPublicId: typeof body.agent_public_id === "string" ? body.agent_public_id : null,
  };
}

function jsonRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function isValidStructuredResponse(value: unknown) {
  const response = jsonRecord(value);
  const choices = response?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return false;
  const choice = jsonRecord(choices[0]);
  if (!choice || choice.finish_reason === "length") return false;
  const message = jsonRecord(choice.message);
  if (!message || typeof message.content !== "string" || !message.content.trim()) {
    return false;
  }
  try {
    return jsonRecord(JSON.parse(message.content)) !== null;
  } catch {
    return false;
  }
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 12_000;
}

function validPublicUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function inputSummary(messages: readonly ChatMessage[]) {
  return messages.map((message) => compact(message.content))
    .filter(Boolean)
    .join("\n")
    .slice(0, 600);
}

function outputSummary(value: unknown) {
  const response = jsonRecord(value);
  const choices = response?.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = jsonRecord(choices[0]);
    const message = jsonRecord(choice?.message);
    if (typeof message?.content === "string") return compact(message.content).slice(0, 600);
  }
  return compact(JSON.stringify(value) ?? "").slice(0, 600);
}

function usage(value: unknown) {
  const response = jsonRecord(value);
  const usageRecord = jsonRecord(response?.usage);
  return {
    inputTokens: Number(usageRecord?.prompt_tokens ?? 0),
    outputTokens: Number(usageRecord?.completion_tokens ?? 0),
  };
}

async function startAgentInvocation(
  deps: AiChatDeps,
  session: WorkspaceSession,
  parsed: ParsedChatRequest,
  modelCode: string,
  authorizedAgent: AuthorizedAgent | null,
  startedAt: number,
) {
  if (!parsed.agentPublicId) return null;
  if (!deps.startAgentInvocation || !deps.finalizeAgentInvocation || !authorizedAgent) return null;
  try {
    const handle = await deps.startAgentInvocation({
      agentPublicId: parsed.agentPublicId,
      actorMemberId: session.member.id,
      modelCode,
      promptVersion: authorizedAgent.version,
      status: "running",
      inputSummary: inputSummary(parsed.messages.filter((message) => message.role !== "system")),
      authorizedAgent,
      startedAt: new Date(startedAt).toISOString(),
    });
    return validPublicUuid(handle?.invocationId) ? handle : null;
  } catch {
    return null;
  }
}

async function finalizeAgentInvocation(
  deps: AiChatDeps,
  invocation: AgentInvocationHandle | null,
  startedAt: number,
  result: {
    status: AgentInvocationFinalizationPayload["status"];
    outputSummary: string;
    usage?: { inputTokens: number; outputTokens: number };
    latencyMs: number;
    errorCode: string;
  },
) {
  if (!invocation) return true;
  if (!deps.finalizeAgentInvocation) return false;
  try {
    await deps.finalizeAgentInvocation({
      invocationId: invocation.invocationId,
      status: result.status,
      outputSummary: result.outputSummary,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      latencyMs: result.latencyMs,
      errorCode: result.errorCode,
      completedAt: new Date(Math.max(startedAt, Date.now())).toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

type InvocationResult = {
  status: AgentInvocationFinalizationPayload["status"];
  outputSummary?: string;
  usage?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
  errorCode: string;
};

async function finalizeRuntimeInvocation(
  deps: AiChatDeps,
  invocation: { invocationId: string } | null,
  startedAt: number,
  result: InvocationResult,
) {
  if (!invocation || !deps.runtime) return true;
  try {
    await deps.runtime.finalize(
      invocation.invocationId,
      result.errorCode === "upstream_timeout" ? "timed_out" : result.status,
      result.usage ?? { inputTokens: 0, outputTokens: 0 },
      result.errorCode,
      new Date(Math.max(startedAt, Date.now())).toISOString(),
      null,
    );
    return true;
  } catch {
    return false;
  }
}

async function finalizeInvocations(
  deps: AiChatDeps,
  agentInvocation: AgentInvocationHandle | null,
  runtimeInvocation: { invocationId: string } | null,
  startedAt: number,
  result: Required<Pick<InvocationResult, "status" | "outputSummary" | "latencyMs" | "errorCode">> & Pick<InvocationResult, "usage">,
) {
  const agentRecorded = await finalizeAgentInvocation(deps, agentInvocation, startedAt, result);
  const runtimeRecorded = await finalizeRuntimeInvocation(deps, runtimeInvocation, startedAt, result);
  return agentRecorded && runtimeRecorded;
}

function authorizationErrorCode(error: unknown): "agent_not_found" | "agent_forbidden" {
  return error && typeof error === "object" && (error as { code?: unknown }).code === "agent_not_found"
    ? "agent_not_found"
    : "agent_forbidden";
}

function consumeProcessRateLimit(key: string) {
  const now = Date.now();
  const current = limits.get(key);
  if (!current || current.resetAt <= now) {
    limits.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 30) return false;
  current.count += 1;
  return true;
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
