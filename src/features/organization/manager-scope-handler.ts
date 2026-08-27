import "server-only";

import { randomUUID } from "node:crypto";

import {
  canReadSupervisorScope,
} from "@/features/auth/workspace-access";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ManagerScopeRpc = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string } | null }>;

export type ManagerScopeDependencies = {
  session?: WorkspaceSession | null;
  loadSession?: () => Promise<WorkspaceSession | null>;
  rpc: ManagerScopeRpc;
  createRequestId?: () => string;
};

export class ManagerScopeStoreError extends Error {
  constructor(readonly code: string | undefined) {
    super("Manager scope store unavailable");
    this.name = "ManagerScopeStoreError";
  }
}

type RouteContext = { params: Promise<{ memberId: string }> };

export function createManagerScopeHandlers(dependencies: ManagerScopeDependencies) {
  async function session() {
    return Object.prototype.hasOwnProperty.call(dependencies, "session")
      ? dependencies.session ?? null
      : dependencies.loadSession?.() ?? null;
  }

  return {
    async GET(_request: Request, context: RouteContext) {
      const workspaceSession = await session();
      if (!workspaceSession) return json({ error: "unauthorized" }, 401);
      const { memberId } = await context.params;
      if (!isUuid(memberId)) return json({ error: "invalid_request" }, 400);
      if (!canReadSupervisorScope(workspaceSession, memberId)) {
        return json({ error: "not_found" }, 404);
      }

      try {
        const result = await dependencies.rpc(
          "current_supervisor_employee_projection",
          { p_employee_public_id: memberId },
        );
        if (result.error) throw new ManagerScopeStoreError(result.error.code);
        const projection = parseProjection(result.data, memberId);
        return projection
          ? json(projection)
          : json({ error: "not_found" }, 404);
      } catch {
        return json({ error: "manager_scope_unavailable" }, 503);
      }
    },

    async POST(request: Request, context: RouteContext) {
      const workspaceSession = await session();
      if (!workspaceSession) return json({ error: "unauthorized" }, 401);
      const { memberId } = await context.params;
      if (!isUuid(memberId)) return json({ error: "invalid_request" }, 400);
      if (
        workspaceSession.member.status !== "active"
        || !workspaceSession.permissionCodes.includes("organization.manage")
      ) {
        return json({ error: "forbidden" }, 403);
      }

      const idempotencyKey = request.headers.get("Idempotency-Key");
      if (!isUuid(idempotencyKey)) {
        return json({ error: "invalid_idempotency_key" }, 400);
      }
      const body = await readObject(request);
      const managerEmployeeId = body && isUuid(body.managerEmployeeId)
        ? body.managerEmployeeId
        : null;
      const expectedVersion = body && positiveInteger(body.expectedVersion);
      const reason = body && boundedText(body.reason, 500);
      if (!body || !managerEmployeeId || !expectedVersion || !reason) {
        return json({ error: "invalid_request" }, 400);
      }

      try {
        const result = await dependencies.rpc("assign_current_member_manager", {
          p_target_employee_public_id: memberId,
          p_manager_employee_public_id: managerEmployeeId,
          p_expected_manager_version: expectedVersion,
          p_reason: reason,
          request_id: dependencies.createRequestId?.() ?? randomUUID(),
          idempotency_key: idempotencyKey,
        });
        if (result.error) throw new ManagerScopeStoreError(result.error.code);
        if (isFailureResult(result.data)) {
          return json({ error: result.data.error }, failureStatus(result.data.error));
        }
        if (!isSuccessResult(result.data)) {
          throw new ManagerScopeStoreError("P0001");
        }
        return json(result.data);
      } catch (error) {
        return mapStoreError(error);
      }
    },
  };
}

function parseProjection(value: unknown, expectedEmployeeId: string) {
  const row = Array.isArray(value) ? value[0] : null;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (
    record.employee_public_id !== expectedEmployeeId
    || !boundedText(record.display_name, 200)
    || !boundedText(record.department_name, 200)
    || !boundedText(record.job_title, 200)
    || !positiveInteger(record.manager_version)
    || !["unassigned", "manual", "directory"].includes(String(record.manager_source))
    || (record.manager_employee_public_id !== null
      && !isUuid(record.manager_employee_public_id))
  ) {
    return null;
  }
  return {
    employeeId: record.employee_public_id,
    displayName: record.display_name,
    departmentName: record.department_name,
    jobTitle: record.job_title,
    managerEmployeeId: record.manager_employee_public_id,
    managerVersion: record.manager_version,
    managerSource: record.manager_source,
  };
}

function isFailureResult(value: unknown): value is { outcome: "failure"; error: string } {
  return Boolean(value) && typeof value === "object"
    && (value as { outcome?: unknown }).outcome === "failure"
    && typeof (value as { error?: unknown }).error === "string";
}

function isSuccessResult(value: unknown): value is {
  outcome: "success";
  id: string;
  version: number;
} {
  return Boolean(value) && typeof value === "object"
    && (value as { outcome?: unknown }).outcome === "success"
    && isUuid((value as { id?: unknown }).id)
    && Boolean(positiveInteger((value as { version?: unknown }).version));
}

function failureStatus(error: string) {
  if (error === "forbidden") return 403;
  if (error === "not_found") return 404;
  if (
    error === "stale_version"
    || error === "manager_cycle"
    || error === "directory_manager_owned"
    || error === "duplicate_request"
    || error === "scope_conflict"
  ) return 409;
  return 400;
}

function mapStoreError(error: unknown) {
  if (error instanceof ManagerScopeStoreError) {
    if (error.code === "42501") return json({ error: "forbidden" }, 403);
    if (error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
    if (error.code === "40001" || error.code === "23505") {
      return json({ error: "stale_version" }, 409);
    }
  }
  return json({ error: "manager_scope_unavailable" }, 503);
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function boundedText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  return parsed.length > 0 && parsed.length <= maximum ? parsed : null;
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const defaultManagerScopeDependencies: ManagerScopeDependencies = {
  loadSession: getWorkspaceSession,
  async rpc(functionName, args) {
    const client = await getSupabaseServerClient();
    return await client.rpc(functionName, args);
  },
};
