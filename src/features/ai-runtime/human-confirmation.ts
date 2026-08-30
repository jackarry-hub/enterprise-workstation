import { createHash, randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { isHighRiskAction, type HighRiskAction } from "@/features/ai-runtime/tool-adapter";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcError = { code?: string } | null;
type RpcResult = { data: unknown; error: RpcError };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>;

export type HumanConfirmationDependencies = {
  loadSession: () => Promise<WorkspaceSession | null>;
  rpc: Rpc;
  createRequestId?: () => string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const item = record(value);
  if (!item) throw new Error("invalid_high_risk_payload");
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(",")}}`;
}

export function hashHighRiskPayload(payload: Record<string, unknown>) {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function statusFor(error: RpcError) {
  return error?.code === "42501" ? 403 : error?.code === "23505" || error?.code === "55000" ? 409 : error?.code === "22023" ? 422 : 503;
}

async function defaults(): Promise<HumanConfirmationDependencies> {
  const client = await getSupabaseServerClient();
  return { loadSession: getWorkspaceSession, rpc: async (name, args) => await client.rpc(name, args) as RpcResult };
}

export async function requireHumanConfirmation(input: {
  resourceId: string;
  action: HighRiskAction;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  ttlSeconds?: number;
}, rpc: Rpc) {
  const payloadHash = hashHighRiskPayload(input.payload);
  const result = await rpc("confirm_current_ai_action", {
    p_resource_id: input.resourceId,
    p_action: input.action,
    p_payload_hash: payloadHash,
    p_ttl_seconds: input.ttlSeconds ?? 120,
    p_request_id: input.idempotencyKey,
  });
  if (result.error) throw Object.assign(new Error("human_confirmation_unavailable"), { cause: result.error });
  const receipt = record(result.data);
  if (!receipt || !UUID_PATTERN.test(String(receipt.confirmationId ?? ""))) throw new Error("human_confirmation_invalid_receipt");
  return { ...receipt, payloadHash };
}

export async function handleHumanConfirmation(request: Request, runId: string, provided?: HumanConfirmationDependencies) {
  if (!UUID_PATTERN.test(runId)) return json({ error: "not_found" }, 404);
  const deps = provided ?? await defaults();
  if (!await deps.loadSession()) return json({ error: "unauthenticated" }, 401);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 65_536) return json({ error: "invalid_request" }, 400);
  let value: Record<string, unknown> | null = null;
  try { value = record(JSON.parse(raw)); } catch { /* invalid body */ }
  const action = value?.action;
  const payload = record(value?.payload);
  const key = request.headers.get("idempotency-key")?.toLowerCase() ?? deps.createRequestId?.() ?? randomUUID();
  if (!isHighRiskAction(action) || !payload || !UUID_PATTERN.test(key)) return json({ error: "invalid_request" }, 400);
  try {
    const receipt = await requireHumanConfirmation({ resourceId: runId, action, payload, idempotencyKey: key, ttlSeconds: 120 }, deps.rpc);
    return json(receipt, 201);
  } catch (error) {
    const cause = error instanceof Error ? error.cause as RpcError : null;
    const status = statusFor(cause);
    return json({ error: status === 403 ? "forbidden" : status === 409 ? "conflict" : status === 422 ? "invalid_request" : "human_confirmation_unavailable" }, status);
  }
}
