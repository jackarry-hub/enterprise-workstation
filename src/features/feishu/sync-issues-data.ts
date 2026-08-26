import "server-only";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type FeishuSyncIssue = {
  id: string;
  code: string;
  severity: "warning" | "error";
  entityType: "user" | "department" | null;
  status: "open" | "resolved";
  createdAt: string;
};
export type FeishuSyncRunSummary = {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  errorCount: number;
};
export type FeishuSyncEventSummary = {
  id: string;
  eventType: string;
  entityType: "user" | "department";
  disposition: "applied" | "reconcile";
  createdAt: string;
};
export type FeishuSyncOperations = {
  status: "ready" | "unavailable";
  issues: FeishuSyncIssue[];
  runs: FeishuSyncRunSummary[];
  events: FeishuSyncEventSummary[];
};
export type FeishuSyncIssueLoadResult = {
  status: "ready" | "unavailable";
  data: FeishuSyncIssue[];
};

function issue(row: Record<string, unknown>): FeishuSyncIssue | null {
  if (typeof row.public_id !== "string" || typeof row.code !== "string"
      || !["warning", "error"].includes(String(row.severity))
      || !["open", "resolved"].includes(String(row.status))
      || typeof row.created_at !== "string") return null;
  const entityType = row.entity_type === "user" || row.entity_type === "department" ? row.entity_type : null;
  return {
    id: row.public_id,
    code: row.code,
    severity: row.severity as FeishuSyncIssue["severity"],
    entityType,
    status: row.status as FeishuSyncIssue["status"],
    createdAt: row.created_at,
  };
}

export async function loadFeishuSyncIssues(
  session: WorkspaceSession,
  clientFactory: () => Promise<ServerClient> = getSupabaseServerClient,
): Promise<FeishuSyncIssueLoadResult> {
  if (!session.permissionCodes.includes("organization.manage")) return { status: "ready", data: [] };
  try {
    const client = await clientFactory();
    const { data, error } = await client
      .from("current_feishu_sync_issues")
      .select("public_id, code, severity, entity_type, status, created_at")
      .eq("organization_public_id", session.organization.id)
      .is("resolved_at", null)
      .order("created_at", { ascending: false });
    if (error) return { status: "unavailable", data: [] };
    return { status: "ready", data: ((data ?? []) as Record<string, unknown>[]).map(issue).filter((value): value is FeishuSyncIssue => value !== null) };
  } catch {
    return { status: "unavailable", data: [] };
  }
}

export async function loadFeishuSyncOperations(
  session: WorkspaceSession,
  clientFactory: () => Promise<ServerClient> = getSupabaseServerClient,
): Promise<FeishuSyncOperations> {
  if (!session.permissionCodes.includes("organization.manage")) return { status: "ready", issues: [], runs: [], events: [] };
  try {
    const client = await clientFactory();
    const organizationResponse = await client.from("organizations").select("id").eq("public_id", session.organization.id).maybeSingle();
    const organizationId = (organizationResponse.data as { id?: unknown } | null)?.id;
    if (organizationResponse.error || !Number.isSafeInteger(organizationId) || Number(organizationId) < 1) {
      return { status: "unavailable", issues: [], runs: [], events: [] };
    }
    const [issueResponse, runResponse, eventResponse] = await Promise.all([
      client.from("current_feishu_sync_issues")
        .select("public_id, code, severity, entity_type, status, created_at")
        .eq("organization_public_id", session.organization.id).is("resolved_at", null)
        .order("created_at", { ascending: false }).limit(50),
      client.from("directory_sync_runs")
        .select("public_id, status, started_at, completed_at, error_count")
        .eq("organization_id", Number(organizationId)).order("started_at", { ascending: false }).limit(10),
      client.from("feishu_webhook_events")
        .select("public_id, event_type, entity_type, disposition, created_at")
        .eq("organization_id", Number(organizationId)).order("created_at", { ascending: false }).limit(20),
    ]);
    if (issueResponse.error || runResponse.error || eventResponse.error) {
      return { status: "unavailable", issues: [], runs: [], events: [] };
    }
    const issues = ((issueResponse.data ?? []) as Record<string, unknown>[])
      .map(issue).filter((value): value is FeishuSyncIssue => value !== null);
    const runs = ((runResponse.data ?? []) as Record<string, unknown>[]).flatMap((row) => {
      if (typeof row.public_id !== "string" || !["running", "completed", "failed"].includes(String(row.status))
          || typeof row.started_at !== "string" || !Number.isInteger(row.error_count)) return [];
      return [{ id: row.public_id, status: row.status as FeishuSyncRunSummary["status"], startedAt: row.started_at,
        completedAt: typeof row.completed_at === "string" ? row.completed_at : null, errorCount: Number(row.error_count) }];
    });
    const events = ((eventResponse.data ?? []) as Record<string, unknown>[]).flatMap((row) => {
      if (typeof row.public_id !== "string" || typeof row.event_type !== "string"
          || (row.entity_type !== "user" && row.entity_type !== "department")
          || (row.disposition !== "applied" && row.disposition !== "reconcile") || typeof row.created_at !== "string") return [];
      return [{ id: row.public_id, eventType: row.event_type,
        entityType: row.entity_type as FeishuSyncEventSummary["entityType"],
        disposition: row.disposition as FeishuSyncEventSummary["disposition"], createdAt: row.created_at }];
    });
    return { status: "ready", issues, runs, events };
  } catch {
    return { status: "unavailable", issues: [], runs: [], events: [] };
  }
}
