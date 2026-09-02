import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
export type AgentStarterPackDependencies = {
  loadSession: () => Promise<WorkspaceSession | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
async function defaults(): Promise<AgentStarterPackDependencies> { const client = await getSupabaseServerClient(); return { loadSession: getWorkspaceSession, rpc: async (name, args) => await client.rpc(name, args) as RpcResult }; }

export async function handleAgentStarterPack(request: Request, provided?: AgentStarterPackDependencies) {
  const deps = provided ?? await defaults();
  const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!session.permissionCodes.includes("agent.manage")) return json({ error: "forbidden" }, 403);
  const requestId = request.headers.get("idempotency-key")?.toLowerCase() ?? "";
  if (!UUID.test(requestId)) return json({ error: "invalid_request" }, 400);
  const result = await deps.rpc("provision_current_agent_starter_pack", { p_request_id: requestId });
  if (result.error) {
    const status = result.error.code === "42501" ? 403 : result.error.code === "22023" ? 422 : 503;
    return json({ error: status === 403 ? "forbidden" : status === 422 ? "invalid_request" : "agent_service_unavailable", requestId }, status);
  }
  return json({ ...(record(result.data) ?? {}), requestId });
}
