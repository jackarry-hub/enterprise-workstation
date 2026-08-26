import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  getFeishuDirectoryEnv,
  loadFeishuDirectorySnapshot,
  type FeishuDirectorySnapshot,
} from "@/features/feishu/directory-sync";
import { getSupabaseEnv } from "@/lib/supabase/env";

export type DirectorySyncMode = "full" | "incremental" | "reconcile";
export type DirectorySyncControlResult = {
  runId: string;
  cursor: string | null;
  status: "completed" | "retry" | "already_running";
  retryAfter: string | null;
};

export type DirectorySyncLease = {
  acquired: boolean;
  runId: string;
  cursor: string | null;
  attempt: number;
  tenantId?: string;
  actorAuthUserId?: string;
};

export type DirectorySyncWorkerDependencies = {
  acquire: (mode: DirectorySyncMode, cursor: string | null) => Promise<DirectorySyncLease>;
  loadSnapshot: () => Promise<FeishuDirectorySnapshot>;
  applySnapshot: (snapshot: FeishuDirectorySnapshot, lease: DirectorySyncLease) => Promise<void>;
  complete: (runId: string, cursor: string | null) => Promise<DirectorySyncControlResult>;
  fail: (runId: string, cursor: string | null, retryAfter: string) => Promise<DirectorySyncControlResult>;
  sleep: (milliseconds: number) => Promise<void>;
};

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("directory_worker_unavailable");
  return createClient(getSupabaseEnv().url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function controlResult(data: unknown): DirectorySyncControlResult {
  if (!data || typeof data !== "object") throw new Error("directory_worker_invalid");
  const row = data as Record<string, unknown>;
  if (typeof row.runId !== "string" || !["completed", "retry", "already_running"].includes(String(row.status))) {
    throw new Error("directory_worker_invalid");
  }
  return {
    runId: row.runId,
    cursor: typeof row.cursor === "string" ? row.cursor : null,
    status: row.status as DirectorySyncControlResult["status"],
    retryAfter: typeof row.retryAfter === "string" ? row.retryAfter : null,
  };
}

export const defaultDirectorySyncWorkerDependencies: DirectorySyncWorkerDependencies = {
  async acquire(mode, cursor) {
    const providerTenantKey = process.env.FEISHU_TENANT_KEY?.trim();
    if (!providerTenantKey) throw new Error("directory_worker_unavailable");
    const { data, error } = await adminClient().rpc("claim_feishu_sync_work", {
      p_mode: mode,
      p_cursor: cursor,
      p_provider_tenant_key: providerTenantKey,
      p_lease_seconds: 120,
    });
    if (error || !data || typeof data !== "object") throw new Error("directory_worker_unavailable");
    const row = data as Record<string, unknown>;
    return {
      acquired: row.acquired === true,
      runId: String(row.runId ?? ""),
      cursor: typeof row.cursor === "string" ? row.cursor : null,
      attempt: Number.isInteger(row.attempt) ? Number(row.attempt) : 1,
      tenantId: typeof row.tenantId === "string" ? row.tenantId : undefined,
      actorAuthUserId: typeof row.actorAuthUserId === "string" ? row.actorAuthUserId : undefined,
    };
  },
  loadSnapshot: () => loadFeishuDirectorySnapshot(getFeishuDirectoryEnv()),
  async applySnapshot(snapshot, lease) {
    if (!lease.tenantId || !lease.actorAuthUserId) throw new Error("directory_worker_scope_invalid");
    const { error } = await adminClient().rpc("apply_feishu_directory_sync_observed", {
      p_tenant_public_id: lease.tenantId,
      p_actor_auth_user_id: lease.actorAuthUserId,
      p_snapshot: snapshot,
      p_request_id: lease.runId,
    });
    if (error) throw new Error("directory_worker_apply_failed");
  },
  async complete(runId, cursor) {
    const { data, error } = await adminClient().rpc("finish_feishu_sync_work", {
      p_run_id: runId,
      p_cursor: cursor,
      p_status: "completed",
      p_retry_after: null,
    });
    if (error) throw new Error("directory_worker_unavailable");
    return controlResult(data);
  },
  async fail(runId, cursor, retryAfter) {
    const { data, error } = await adminClient().rpc("finish_feishu_sync_work", {
      p_run_id: runId,
      p_cursor: cursor,
      p_status: "retry",
      p_retry_after: retryAfter,
    });
    if (error) throw new Error("directory_worker_unavailable");
    return controlResult(data);
  },
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

async function run(
  mode: DirectorySyncMode,
  cursor: string | null,
  dependencies: DirectorySyncWorkerDependencies,
) {
  const lease = await dependencies.acquire(mode, cursor);
  if (!lease.acquired) {
    return { runId: lease.runId, cursor: lease.cursor, status: "already_running" as const, retryAfter: null };
  }
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // The provider exposes a complete, authoritative snapshot. Incremental
        // cursors select work durably; applying the full snapshot avoids stale
        // partial mutations while preserving the event ordering contract.
        const snapshot = await dependencies.loadSnapshot();
        await dependencies.applySnapshot(snapshot, lease);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await dependencies.sleep(250 * (2 ** attempt));
      }
    }
    if (lastError) throw lastError;
    return dependencies.complete(lease.runId, lease.cursor);
  } catch {
    const retryAfter = new Date(Date.now() + Math.min(300_000, 1_000 * (2 ** Math.min(lease.attempt, 8)))).toISOString();
    return dependencies.fail(lease.runId, lease.cursor, retryAfter);
  }
}

export function startFeishuFullSync(dependencies = defaultDirectorySyncWorkerDependencies) {
  return run("full", null, dependencies);
}

export function resumeFeishuIncrementalSync(cursor: string, dependencies = defaultDirectorySyncWorkerDependencies) {
  if (!cursor.trim() || cursor.length > 200) throw new Error("directory_cursor_invalid");
  return run("incremental", cursor, dependencies);
}

export function reconcileFeishuDirectory(dependencies = defaultDirectorySyncWorkerDependencies) {
  return run("reconcile", null, dependencies);
}

export type ScheduledFeishuDirectorySyncDependencies = {
  nextCursor: () => Promise<string | null>;
  incremental: (cursor: string) => Promise<DirectorySyncControlResult>;
  reconcile: () => Promise<DirectorySyncControlResult>;
};

export const defaultScheduledFeishuDirectorySyncDependencies: ScheduledFeishuDirectorySyncDependencies = {
  async nextCursor() {
    const providerTenantKey = process.env.FEISHU_TENANT_KEY?.trim();
    if (!providerTenantKey) throw new Error("directory_worker_unavailable");
    const { data, error } = await adminClient().rpc("next_feishu_sync_cursor", {
      p_provider_tenant_key: providerTenantKey,
    });
    if (error) throw new Error("directory_worker_unavailable");
    return typeof data === "string" && data ? data : null;
  },
  incremental: resumeFeishuIncrementalSync,
  reconcile: reconcileFeishuDirectory,
};

export async function runScheduledFeishuDirectorySync(
  dependencies = defaultScheduledFeishuDirectorySyncDependencies,
) {
  const cursor = await dependencies.nextCursor();
  return cursor ? dependencies.incremental(cursor) : dependencies.reconcile();
}
