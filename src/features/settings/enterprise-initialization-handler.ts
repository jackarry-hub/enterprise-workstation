import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
export type EnterpriseInitializationDependencies = {
  loadSession: () => Promise<WorkspaceSession | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  createRequestId?: () => string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

async function defaults(): Promise<EnterpriseInitializationDependencies> {
  const client = await getSupabaseServerClient();
  return {
    loadSession: getWorkspaceSession,
    rpc: async (name, args) => await client.rpc(name, args) as RpcResult,
  };
}

function text(value: unknown, maximum: number, required = true) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximum) return null;
  return normalized;
}

function errorStatus(error: RpcResult["error"]) {
  return error?.code === "42501" ? 403 : error?.code === "22023" ? 422 : 503;
}

export async function handleEnterpriseInitialization(
  request: Request,
  provided?: EnterpriseInitializationDependencies,
) {
  const deps = provided ?? await defaults();
  const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  const canInitialize = session.roleCodes.includes("owner");

  if (request.method === "GET") {
    const result = await deps.rpc("current_tenant_initialization", {});
    if (result.error) return json({ error: "enterprise_initialization_unavailable" }, errorStatus(result.error));
    return json({ ...(record(result.data) ?? {}), canInitialize });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!canInitialize) return json({ error: "forbidden" }, 403);

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 16_384) return json({ error: "invalid_request" }, 400);
  let value: Record<string, unknown> | null = null;
  try { value = record(JSON.parse(raw)); } catch { /* invalid JSON */ }
  const companyName = text(value?.companyName, 120);
  const shortName = text(value?.shortName, 80);
  const industry = text(value?.industry, 120);
  const description = text(value?.description ?? "", 1_000, false);
  const timezone = text(value?.timezone, 80);
  if (!companyName || !shortName || !industry || description === null || !timezone) {
    return json({ error: "invalid_request" }, 400);
  }

  const requestId = request.headers.get("idempotency-key")?.toLowerCase()
    ?? deps.createRequestId?.()
    ?? randomUUID();
  const result = await deps.rpc("activate_current_enterprise", {
    p_company_name: companyName,
    p_short_name: shortName,
    p_industry: industry,
    p_description: description,
    p_timezone: timezone,
    p_request_id: requestId,
  });
  if (result.error) {
    const status = errorStatus(result.error);
    return json({ error: status === 403 ? "forbidden" : status === 422 ? "invalid_request" : "enterprise_initialization_unavailable" }, status);
  }
  return json({ ...(record(result.data) ?? {}), canInitialize: true, requestId });
}
