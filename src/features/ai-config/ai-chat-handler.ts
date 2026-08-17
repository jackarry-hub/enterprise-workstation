import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import type { AiConfigStore } from "@/features/ai-config/ai-config-store";
import { isAllowedAiModel } from "@/features/ai-config/ai-config-types";
import { decryptApiKey } from "@/features/ai-config/ai-secret-crypto";

type AiChatDeps = {
  session: WorkspaceSession | null;
  store: Pick<AiConfigStore, "get">;
  encryptionKey: Uint8Array;
  fetchImpl?: typeof fetch;
  consumeRateLimit?: (key: string) => boolean;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const limits = new Map<string, { count: number; resetAt: number }>();

export async function handleAiChat(request: Request, deps: AiChatDeps) {
  const session = deps.session;
  if (!session) return json({ error: "unauthorized" }, 401);

  const limitKey = `${session.tenantId}:${session.authUserId}`;
  const consume = deps.consumeRateLimit ?? consumeProcessRateLimit;
  if (!consume(limitKey)) return json({ error: "rate_limited" }, 429);

  const parsed = await parseChatRequest(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);

  const config = await deps.store.get(session.tenantId);
  if (!config?.encrypted_api_key || !config.api_key_iv) {
    return json({ error: "ai_not_configured" }, 409);
  }
  if (!isAllowedAiModel(config.model_name)) {
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

  try {
    const upstream = await (deps.fetchImpl ?? fetch)(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model_name,
          messages: parsed.messages,
          max_tokens: parsed.maxTokens,
        }),
        signal: AbortSignal.timeout(45_000),
      },
    );

    if (upstream.status === 401 || upstream.status === 403) {
      return json({ error: "upstream_auth_failed" }, 502);
    }
    if (!upstream.ok) return json({ error: "upstream_failed" }, 502);

    let data: unknown;
    try {
      data = await upstream.json();
    } catch {
      return json({ error: "upstream_invalid_response" }, 502);
    }
    return json(data);
  } catch (error) {
    if (
      error instanceof DOMException
      && (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return json({ error: "upstream_timeout" }, 504);
    }
    return json({ error: "upstream_unavailable" }, 502);
  }
}

async function parseChatRequest(request: Request): Promise<
  | { error: string; status: number; messages?: never; maxTokens?: never }
  | { messages: ChatMessage[]; maxTokens: number; error?: never; status?: never }
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
  return { messages, maxTokens };
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 12_000;
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
