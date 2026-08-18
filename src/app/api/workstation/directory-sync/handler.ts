import { createClient } from "@supabase/supabase-js";

import {
  getFeishuDirectoryEnv,
  loadFeishuDirectorySnapshot,
  type FeishuDirectorySnapshot,
} from "@/features/feishu/directory-sync";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseEnv } from "@/lib/supabase/env";

type DirectorySession = {
  tenantId?: string;
  authUserId?: string;
  roleCodes: readonly string[];
};

export type DirectorySyncDependencies = {
  loadSession: () => Promise<DirectorySession | null>;
  loadSnapshot: () => Promise<FeishuDirectorySnapshot>;
  applySnapshot: (
    session: DirectorySession,
    snapshot: FeishuDirectorySnapshot,
  ) => Promise<unknown>;
};

export function createDirectorySyncHandler(dependencies: DirectorySyncDependencies) {
  return async function syncDirectory() {
    const session = await dependencies.loadSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (!session.roleCodes.some((role) => role === "owner" || role === "admin")) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    try {
      const snapshot = await dependencies.loadSnapshot();
      const result = await dependencies.applySnapshot(session, snapshot);
      return Response.json(result, {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return Response.json(
        { error: "directory_sync_failed" },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
  };
}

export const defaultDirectorySyncDependencies: DirectorySyncDependencies = {
  loadSession: getWorkspaceSession,
  loadSnapshot: () => loadFeishuDirectorySnapshot(getFeishuDirectoryEnv()),
  async applySnapshot(session, snapshot) {
    if (!session.tenantId || !session.authUserId) {
      throw new Error("directory_actor_invalid");
    }
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!serviceRoleKey) throw new Error("supabase_service_role_missing");
    const { url } = getSupabaseEnv();
    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("apply_feishu_directory_sync", {
      p_tenant_public_id: session.tenantId,
      p_actor_auth_user_id: session.authUserId,
      p_snapshot: snapshot,
    });
    if (error) throw error;
    return data;
  },
};
