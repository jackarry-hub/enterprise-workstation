import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  DirectorySyncError,
  getFeishuDirectoryEnv,
  loadFeishuDirectorySnapshot,
  type DirectorySyncErrorCode,
  type FeishuDirectorySnapshot,
} from "@/features/feishu/directory-sync";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspacePermissionCode } from "@/features/auth/workspace-session-types";
import { getSupabaseEnv } from "@/lib/supabase/env";

type DirectorySession = {
  tenantId?: string;
  authUserId?: string;
  roleCodes: readonly string[];
  permissionCodes: readonly WorkspacePermissionCode[];
};

export type DirectorySyncResult = {
  runId: string;
  status: "completed" | "failed";
  departmentCount: number;
  employeeCount: number;
  issueCount: number;
};

export type DirectorySyncFailureCode = DirectorySyncErrorCode
  | "directory_apply_failed"
  | "directory_unexpected";

type SafeFailureLog = {
  event: "directory_sync_failed";
  code: DirectorySyncFailureCode;
  requestId: string;
};

export type DirectorySyncDependencies = {
  loadSession: () => Promise<DirectorySession | null>;
  loadSnapshot: () => Promise<FeishuDirectorySnapshot>;
  applySnapshot: (
    session: DirectorySession,
    snapshot: FeishuDirectorySnapshot,
    requestId: string,
  ) => Promise<DirectorySyncResult>;
  recordFailure?: (
    session: DirectorySession,
    code: DirectorySyncFailureCode,
    requestId: string,
  ) => Promise<DirectorySyncResult>;
  createRequestId?: () => string;
  logFailure?: (entry: SafeFailureLog) => void;
};

const SNAPSHOT_FAILURE_CODES = new Set<DirectorySyncFailureCode>([
  "directory_configuration_invalid",
  "directory_provider_unavailable",
  "directory_pagination_invalid",
  "directory_pagination_limit",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function responseHeaders(requestId: string) {
  return { "cache-control": "no-store", "x-request-id": requestId };
}

function knownSnapshotFailure(error: unknown): DirectorySyncFailureCode {
  if (error instanceof DirectorySyncError) return error.code;
  if (error && typeof error === "object") {
    const candidate = (error as { code?: unknown }).code;
    if (typeof candidate === "string" && SNAPSHOT_FAILURE_CODES.has(candidate as DirectorySyncFailureCode)) {
      return candidate as DirectorySyncFailureCode;
    }
  }
  return "directory_unexpected";
}

function validResult(value: unknown): value is DirectorySyncResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.runId === "string" && UUID_PATTERN.test(result.runId)
    && (result.status === "completed" || result.status === "failed")
    && [result.departmentCount, result.employeeCount, result.issueCount]
      .every((count) => typeof count === "number" && Number.isInteger(count) && count >= 0);
}

function unavailable(
  code: DirectorySyncFailureCode,
  requestId: string,
  runId?: string,
) {
  return Response.json(
    {
      error: {
        code,
        requestId,
        ...(runId ? { runId } : {}),
      },
    },
    { status: 502, headers: responseHeaders(requestId) },
  );
}

export function createDirectorySyncHandler(dependencies: DirectorySyncDependencies) {
  return async function syncDirectory() {
    const session = await dependencies.loadSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (!session.permissionCodes.includes("organization.manage")) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    const requestId = dependencies.createRequestId?.() ?? randomUUID();
    const recordFailure = async (code: DirectorySyncFailureCode) => {
      dependencies.logFailure?.({ event: "directory_sync_failed", code, requestId });
      try {
        const result = await dependencies.recordFailure?.(session, code, requestId);
        return validResult(result) && result.status === "failed" ? result.runId : undefined;
      } catch {
        return undefined;
      }
    };

    let snapshot: FeishuDirectorySnapshot;
    try {
      snapshot = await dependencies.loadSnapshot();
    } catch (error) {
      const code = knownSnapshotFailure(error);
      return unavailable(code, requestId, await recordFailure(code));
    }

    try {
      const result = await dependencies.applySnapshot(session, snapshot, requestId);
      if (!validResult(result)) throw new Error("directory_sync_result_invalid");
      return Response.json(result, { headers: responseHeaders(requestId) });
    } catch {
      const code: DirectorySyncFailureCode = "directory_apply_failed";
      return unavailable(code, requestId, await recordFailure(code));
    }
  };
}

function parseRpcResult(value: unknown): DirectorySyncResult {
  if (!validResult(value)) throw new Error("directory_sync_result_invalid");
  return value;
}

export const defaultDirectorySyncDependencies: DirectorySyncDependencies = {
  loadSession: getWorkspaceSession,
  loadSnapshot: () => loadFeishuDirectorySnapshot(getFeishuDirectoryEnv()),
  async applySnapshot(session, snapshot, requestId) {
    if (!session.tenantId || !session.authUserId) {
      throw new Error("directory_actor_invalid");
    }
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!serviceRoleKey) throw new Error("supabase_service_role_missing");
    const { url } = getSupabaseEnv();
    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("apply_feishu_directory_sync_observed", {
      p_tenant_public_id: session.tenantId,
      p_actor_auth_user_id: session.authUserId,
      p_snapshot: snapshot,
      p_request_id: requestId,
    });
    if (error) throw error;
    return parseRpcResult(data);
  },
  async recordFailure(session, code, requestId) {
    if (!session.tenantId || !session.authUserId) {
      throw new Error("directory_actor_invalid");
    }
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!serviceRoleKey) throw new Error("supabase_service_role_missing");
    const { url } = getSupabaseEnv();
    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("record_feishu_directory_sync_failure", {
      p_tenant_public_id: session.tenantId,
      p_actor_auth_user_id: session.authUserId,
      p_code: code,
      p_request_id: requestId,
    });
    if (error) throw error;
    return parseRpcResult(data);
  },
  logFailure(entry) {
    console.error("[directory-sync] failed", entry);
  },
};
