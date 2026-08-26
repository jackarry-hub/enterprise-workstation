import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspacePermissionCode } from "@/features/auth/workspace-session-types";
import { getSupabaseEnv } from "@/lib/supabase/env";

type ResolutionSession = {
  organizationId: string;
  authUserId: string;
  permissionCodes: readonly WorkspacePermissionCode[];
};

export type ResolveFeishuSyncIssueDependencies = {
  loadSession: () => Promise<ResolutionSession | null>;
  resolve: (input: { organizationId: string; authUserId: string; issueId: string }) => Promise<"resolved" | "not_found">;
};

export function createResolveFeishuSyncIssueHandler(dependencies: ResolveFeishuSyncIssueDependencies) {
  return async function resolveIssue(
    _request: Request,
    context: { params: Promise<{ issueId: string }> },
  ) {
    const session = await dependencies.loadSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (!session.permissionCodes.includes("organization.manage")) return Response.json({ error: "forbidden" }, { status: 403 });
    const { issueId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(issueId)) return Response.json({ error: "invalid_request" }, { status: 400 });
    try {
      const status = await dependencies.resolve({ organizationId: session.organizationId, authUserId: session.authUserId, issueId });
      return status === "resolved"
        ? Response.json({ status }, { headers: { "cache-control": "no-store" } })
        : Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
    } catch {
      return Response.json({ error: "resolve_failed" }, { status: 502, headers: { "cache-control": "no-store" } });
    }
  };
}

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("resolve_unavailable");
  return createClient(getSupabaseEnv().url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export const defaultResolveFeishuSyncIssueDependencies: ResolveFeishuSyncIssueDependencies = {
  async loadSession() {
    const session = await getWorkspaceSession();
    return session ? { organizationId: session.organization.id, authUserId: session.authUserId, permissionCodes: session.permissionCodes } : null;
  },
  async resolve(input) {
    const { data, error } = await adminClient().rpc("resolve_feishu_sync_issue", {
      p_organization_public_id: input.organizationId,
      p_actor_auth_user_id: input.authUserId,
      p_issue_public_id: input.issueId,
    });
    if (error || (data !== "resolved" && data !== "not_found")) throw new Error("resolve_failed");
    return data;
  },
};
