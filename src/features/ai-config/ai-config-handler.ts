import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import type {
  AiConfigStore,
  AiConfigUpdateCommand,
} from "@/features/ai-config/ai-config-store";
import {
  AiConfigStoreError,
  sanitizeAiConfig,
} from "@/features/ai-config/ai-config-store";
import {
  AI_PROVIDER,
  isAllowedAiModel,
  type PublicAiConfig,
} from "@/features/ai-config/ai-config-types";
import { encryptApiKey } from "@/features/ai-config/ai-secret-crypto";

type AiConfigGetDeps = {
  session: WorkspaceSession | null;
  store: Pick<AiConfigStore, "get">;
};

type AiConfigPutDeps = {
  session: WorkspaceSession | null;
  store: {
    update(command: AiConfigUpdateCommand): Promise<Omit<PublicAiConfig, "canManage">>;
  };
  encryptionKey: Uint8Array;
};

export async function handleGetAiConfig(deps: AiConfigGetDeps) {
  if (!deps.session) return json({ error: "unauthorized" }, 401);
  const record = await deps.store.get(deps.session.tenantId);
  return json(sanitizeAiConfig(record, canManage(deps.session)));
}

export async function handlePutAiConfig(
  request: Request,
  deps: AiConfigPutDeps,
) {
  const session = deps.session;
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!canManage(session)) return json({ error: "forbidden" }, 403);

  const requestId = request.headers.get("Idempotency-Key");
  if (!isUuid(requestId)) return json({ error: "invalid_idempotency_key" }, 400);

  const body = await readObject(request);
  if (!body || !isAllowedAiModel(body.model)) {
    return json({ error: "invalid_model" }, 400);
  }
  const apiKey = body.apiKey;
  if (apiKey !== undefined && !isValidApiKey(apiKey)) {
    return json({ error: "invalid_api_key" }, 400);
  }

  const next: AiConfigUpdateCommand = {
    provider: AI_PROVIDER,
    model: body.model,
    encryptedKey: null,
    keyHint: null,
    requestId,
  };

  if (typeof apiKey === "string") {
    const encrypted = await encryptApiKey(apiKey.trim(), deps.encryptionKey);
    next.encryptedKey = JSON.stringify({
      v: 1,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
    });
    next.keyHint = encrypted.hint;
  }

  try {
    const saved = await deps.store.update(next);
    return json({ ...saved, canManage: true });
  } catch (error) {
    return mapCommandError(error);
  }
}

function canManage(session: WorkspaceSession) {
  return session.member.status === "active"
    && session.permissionCodes.includes("ai.config.manage");
}

function isValidApiKey(value: unknown): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.startsWith("sk-")
    && value.length >= 12
    && value.length <= 300;
}

function isUuid(value: string | null): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function mapCommandError(error: unknown): Response {
  if (!(error instanceof AiConfigStoreError)) throw error;
  if (error.code === "42501") return json({ error: "forbidden" }, 403);
  if (error.code === "23505") return json({ error: "duplicate_request" }, 409);
  if (error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
  throw error;
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
