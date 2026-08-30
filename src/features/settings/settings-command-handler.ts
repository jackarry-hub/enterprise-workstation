import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
export type SettingsDependencies = { loadSession: () => Promise<WorkspaceSession | null>; rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>; createRequestId?: () => string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i; const NAMESPACES = new Set(["organization", "personal", "notifications", "scheduler"]);
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
async function defaults(): Promise<SettingsDependencies> { const client = await getSupabaseServerClient(); return { loadSession: getWorkspaceSession, rpc: async (name, args) => await client.rpc(name, args) as RpcResult }; }
function statusFor(error: RpcResult["error"]) { return error?.code === "42501" ? 403 : error?.code === "40001" ? 409 : error?.code === "22023" ? 422 : 503; }

export async function handleWorkspaceSettings(request: Request, provided?: SettingsDependencies) {
  const deps = provided ?? await defaults(); const session = await deps.loadSession(); if (!session) return json({ error: "unauthenticated" }, 401);
  if (request.method === "GET") { const result = await deps.rpc("current_workspace_settings", {}); return result.error ? json({ error: "settings_unavailable" }, statusFor(result.error)) : json(record(result.data) ?? {}); }
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405); const raw = await request.text(); if (Buffer.byteLength(raw, "utf8") > 65_536) return json({ error: "invalid_request" }, 400); let body: Record<string, unknown> | null = null; try { body = record(JSON.parse(raw)); } catch { /* invalid */ }
  const namespace = String(body?.namespace ?? ""); const settings = record(body?.settings); const expectedVersion = Number(body?.expectedVersion); const requestId = request.headers.get("idempotency-key")?.toLowerCase() ?? deps.createRequestId?.() ?? randomUUID();
  if (!NAMESPACES.has(namespace) || !settings || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !UUID.test(requestId)) return json({ error: "invalid_request" }, 400);
  if (["organization", "scheduler"].includes(namespace) && !session.permissionCodes.includes("settings.manage")) return json({ error: "forbidden" }, 403);
  const result = await deps.rpc("update_current_workspace_settings", { p_namespace: namespace, p_payload: settings, p_expected_version: expectedVersion, p_request_id: requestId }); if (result.error) { const status = statusFor(result.error); return json({ error: status === 403 ? "forbidden" : status === 409 ? "version_conflict" : status === 422 ? "invalid_settings" : "settings_unavailable" }, status); }
  return json(record(result.data) ?? { requestId });
}
