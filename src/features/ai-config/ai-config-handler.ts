import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import type { AiConfigStore } from "@/features/ai-config/ai-config-store";
import { sanitizeAiConfig } from "@/features/ai-config/ai-config-store";
import {
  AI_BASE_URL,
  AI_PROVIDER,
  isAllowedAiModel,
  type AiConfigRecord,
} from "@/features/ai-config/ai-config-types";
import { encryptApiKey } from "@/features/ai-config/ai-secret-crypto";

type AiConfigHandlerDeps = {
  session: WorkspaceSession | null;
  store: Pick<AiConfigStore, "get" | "upsert">;
  encryptionKey: Uint8Array;
  now?: () => Date;
};

export async function handleGetAiConfig(deps: AiConfigHandlerDeps) {
  if (!deps.session) return json({ error: "unauthorized" }, 401);
  const record = await deps.store.get(deps.session.tenantId);
  return json(sanitizeAiConfig(record, canManage(deps.session)));
}

export async function handlePutAiConfig(
  request: Request,
  deps: AiConfigHandlerDeps,
) {
  const session = deps.session;
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!canManage(session)) return json({ error: "forbidden" }, 403);

  const body = await readObject(request);
  if (!body || !isAllowedAiModel(body.model)) {
    return json({ error: "invalid_model" }, 400);
  }
  const apiKey = body.apiKey;
  if (apiKey !== undefined && !isValidApiKey(apiKey)) {
    return json({ error: "invalid_api_key" }, 400);
  }

  const current = await deps.store.get(session.tenantId);
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const next: AiConfigRecord = {
    tenant_id: session.tenantId,
    provider: AI_PROVIDER,
    model_name: body.model,
    api_base_url: AI_BASE_URL,
    encrypted_api_key: current?.encrypted_api_key ?? null,
    api_key_iv: current?.api_key_iv ?? null,
    key_hint: current?.key_hint ?? null,
    updated_at: now,
    updated_by: session.authUserId,
  };

  if (typeof apiKey === "string") {
    const encrypted = await encryptApiKey(apiKey.trim(), deps.encryptionKey);
    next.encrypted_api_key = encrypted.ciphertext;
    next.api_key_iv = encrypted.iv;
    next.key_hint = encrypted.hint;
  }

  const saved = await deps.store.upsert(next);
  return json(sanitizeAiConfig(saved, true));
}

function canManage(session: WorkspaceSession) {
  return session.member.status === "active";
}

function isValidApiKey(value: unknown): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.startsWith("sk-")
    && value.length >= 12
    && value.length <= 300;
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
