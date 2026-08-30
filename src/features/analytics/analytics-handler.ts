import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
export type AnalyticsDependencies = { loadSession: () => Promise<WorkspaceSession | null>; rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult> };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }
function validDate(value: string) { if (!DATE.test(value)) return false; const [year, month, day] = value.split("-").map(Number); const date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day; }
async function defaults(): Promise<AnalyticsDependencies> { const client = await getSupabaseServerClient(); return { loadSession: getWorkspaceSession, rpc: async (name, args) => await client.rpc(name, args) as RpcResult }; }

export async function handleCommercialAnalytics(request: Request, provided?: AnalyticsDependencies) {
  const deps = provided ?? await defaults(); const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (!session.permissionCodes.includes("analytics.read")) return json({ error: "forbidden" }, 403);
  const url = new URL(request.url); const fromDate = url.searchParams.get("from"); const toDate = url.searchParams.get("to");
  if (!fromDate || !toDate || !validDate(fromDate) || !validDate(toDate)) return json({ error: "invalid_range" }, 400);
  const from = Date.parse(`${fromDate}T00:00:00Z`); const to = Date.parse(`${toDate}T00:00:00Z`); const today = new Date(); const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (from > to || (to - from) / 86_400_000 > 365 || to > utcToday) return json({ error: "invalid_range" }, 400);
  const result = await deps.rpc("current_commercial_metrics", { from_date: fromDate, to_date: toDate });
  if (result.error) return json({ error: result.error.code === "42501" ? "forbidden" : result.error.code === "22023" ? "invalid_range" : "analytics_unavailable" }, result.error.code === "42501" ? 403 : result.error.code === "22023" ? 400 : 503);
  return json(result.data);
}
