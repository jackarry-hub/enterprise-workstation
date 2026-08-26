import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  getFeishuDirectoryEnv,
  loadFeishuDirectorySnapshot,
  type FeishuDirectorySnapshot,
} from "@/features/feishu/directory-sync";
import { getSupabaseEnv } from "@/lib/supabase/env";

export type DirectorySyncMode = "full" | "incremental" | "reconcile";
export type DirectorySyncNoWorkReason = "no_connection" | "active_lease" | "backoff" | "invalid_cursor";
export type DirectorySyncScope = { organizationId: string; actorAuthUserId: string };
export type DirectorySyncControlResult = {
  runId: string | null;
  cursor: string | null;
  status: "completed" | "retry" | "no_work";
  retryAfter: string | null;
  reason?: DirectorySyncNoWorkReason;
};

export type DirectorySyncLease = {
  acquired: boolean;
  runId: string | null;
  cursor: string | null;
  attempt: number;
  tenantId?: string;
  organizationId?: string;
  actorAuthUserId?: string;
  reason?: DirectorySyncNoWorkReason;
  retryAfter?: string | null;
};

export type DirectorySyncWorkerDependencies = {
  acquire: (mode: DirectorySyncMode, cursor: string | null, scope?: DirectorySyncScope) => Promise<DirectorySyncLease>;
  loadSnapshot: (onPage?: () => Promise<void>) => Promise<FeishuDirectorySnapshot>;
  heartbeat: (lease: DirectorySyncLease) => Promise<boolean>;
  applySnapshot: (snapshot: FeishuDirectorySnapshot, lease: DirectorySyncLease) => Promise<void>;
  complete: (runId: string, cursor: string | null, lease?: DirectorySyncLease) => Promise<DirectorySyncControlResult>;
  fail: (runId: string, cursor: string | null, retryAfter: string, lease?: DirectorySyncLease) => Promise<DirectorySyncControlResult>;
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
  const runId = typeof row.runId === "string" ? row.runId : null;
  if ((runId === null && row.status !== "no_work") || !["completed", "retry", "no_work"].includes(String(row.status))) {
    throw new Error("directory_worker_invalid");
  }
  return {
    runId,
    cursor: typeof row.cursor === "string" ? row.cursor : null,
    status: row.status as DirectorySyncControlResult["status"],
    retryAfter: typeof row.retryAfter === "string" ? row.retryAfter : null,
    ...(typeof row.reason === "string" ? { reason: row.reason as DirectorySyncNoWorkReason } : {}),
  };
}

export const defaultDirectorySyncWorkerDependencies: DirectorySyncWorkerDependencies = {
  async acquire(mode, cursor, scope) {
    const providerTenantKey = process.env.FEISHU_TENANT_KEY?.trim();
    if (!providerTenantKey) throw new Error("directory_worker_unavailable");
    const { data, error } = await adminClient().rpc("claim_feishu_sync_work", {
      p_mode: mode,
      p_cursor: cursor,
      p_provider_tenant_key: providerTenantKey,
      p_lease_seconds: 120,
      p_organization_public_id: scope?.organizationId ?? null,
      p_actor_auth_user_id: scope?.actorAuthUserId ?? null,
    });
    if (error || !data || typeof data !== "object") throw new Error("directory_worker_unavailable");
    const row = data as Record<string, unknown>;
    return {
      acquired: row.acquired === true,
      runId: typeof row.runId === "string" ? row.runId : null,
      cursor: typeof row.cursor === "string" ? row.cursor : null,
      attempt: Number.isInteger(row.attempt) ? Number(row.attempt) : 1,
      tenantId: typeof row.tenantId === "string" ? row.tenantId : undefined,
      organizationId: typeof row.organizationId === "string" ? row.organizationId : undefined,
      actorAuthUserId: typeof row.actorAuthUserId === "string" ? row.actorAuthUserId : undefined,
      reason: typeof row.reason === "string" ? row.reason as DirectorySyncNoWorkReason : undefined,
      retryAfter: typeof row.retryAfter === "string" ? row.retryAfter : null,
    };
  },
  loadSnapshot: (onPage) => loadFeishuDirectorySnapshot(getFeishuDirectoryEnv(), fetch, {
    fetchTimeoutMs: 15_000,
    onPage,
  }),
  async heartbeat(lease) {
    if (!lease.runId || !lease.organizationId) return false;
    const { data, error } = await adminClient().rpc("heartbeat_feishu_sync_work", {
      p_run_id: lease.runId,
      p_organization_public_id: lease.organizationId,
      p_lease_seconds: 120,
    });
    if (error) throw new Error("directory_worker_unavailable");
    return data === true;
  },
  async applySnapshot(snapshot, lease) {
    if (!lease.runId || !lease.organizationId || !lease.actorAuthUserId) throw new Error("directory_worker_scope_invalid");
    const { data, error } = await adminClient().rpc("apply_feishu_directory_sync_fenced", {
      p_run_id: lease.runId,
      p_organization_public_id: lease.organizationId,
      p_actor_auth_user_id: lease.actorAuthUserId,
      p_snapshot: snapshot,
    });
    const status = data && typeof data === "object"
      ? (data as Record<string, unknown>).status
      : null;
    if (error || status !== "completed") throw new Error("directory_worker_apply_failed");
  },
  async complete(runId, cursor, lease) {
    const { data, error } = await adminClient().rpc("finish_feishu_sync_work", {
      p_run_id: runId,
      p_cursor: cursor,
      p_status: "completed",
      p_retry_after: null,
      p_organization_public_id: lease?.organizationId ?? null,
    });
    if (error) throw new Error("directory_worker_unavailable");
    return controlResult(data);
  },
  async fail(runId, cursor, retryAfter, lease) {
    const { data, error } = await adminClient().rpc("finish_feishu_sync_work", {
      p_run_id: runId,
      p_cursor: cursor,
      p_status: "retry",
      p_retry_after: retryAfter,
      p_organization_public_id: lease?.organizationId ?? null,
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
  scope?: DirectorySyncScope,
) {
  const lease = await dependencies.acquire(mode, cursor, scope);
  if (!lease.acquired) {
    return {
      runId: lease.runId,
      cursor: lease.cursor,
      status: "no_work" as const,
      retryAfter: lease.retryAfter ?? null,
      ...(lease.reason ? { reason: lease.reason } : {}),
    };
  }
  if (!lease.runId) throw new Error("directory_worker_invalid");
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // The provider exposes a complete, authoritative snapshot. Incremental
        // cursors select work durably; applying the full snapshot avoids stale
        // partial mutations while preserving the event ordering contract.
        if (!await dependencies.heartbeat(lease)) throw new Error("directory_worker_lease_lost");
        const snapshot = await dependencies.loadSnapshot(async () => {
          if (!await dependencies.heartbeat(lease)) throw new Error("directory_worker_lease_lost");
        });
        if (!await dependencies.heartbeat(lease)) throw new Error("directory_worker_lease_lost");
        await dependencies.applySnapshot(snapshot, lease);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await dependencies.sleep(250 * (2 ** attempt));
      }
    }
    if (lastError) throw lastError;
    return dependencies.complete(lease.runId, lease.cursor, lease);
  } catch {
    const retryAfter = new Date(Date.now() + Math.min(300_000, 1_000 * (2 ** Math.min(lease.attempt, 8)))).toISOString();
    return dependencies.fail(lease.runId, lease.cursor, retryAfter, lease);
  }
}

export function startFeishuFullSync(dependencies = defaultDirectorySyncWorkerDependencies) {
  return run("full", null, dependencies);
}

export function startFeishuFullSyncForOrganization(
  scope: DirectorySyncScope,
  dependencies = defaultDirectorySyncWorkerDependencies,
) {
  return run("full", null, dependencies, scope);
}

export function resumeFeishuIncrementalSync(cursor: string, dependencies = defaultDirectorySyncWorkerDependencies) {
  if (!/^[1-9]\d{0,18}$/.test(cursor)) throw new Error("directory_cursor_invalid");
  return run("incremental", cursor, dependencies);
}

export function reconcileFeishuDirectory(dependencies = defaultDirectorySyncWorkerDependencies) {
  return run("reconcile", null, dependencies);
}

export function reconcileFeishuDirectoryForOrganization(
  scope: DirectorySyncScope,
  dependencies = defaultDirectorySyncWorkerDependencies,
) {
  return run("reconcile", null, dependencies, scope);
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
