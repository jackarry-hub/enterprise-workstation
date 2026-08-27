import { randomUUID } from "node:crypto";

import { canonicalUuid, readStrictJson } from "@/app/api/workstation/tasks/handler";

type RpcResult = { data: unknown; error: { code?: string } | null };
type Context = { params: Promise<{ projectId: string }> };
type NotificationContext = { params: Promise<{ notificationId: string }> };

export type ProjectCommercialCommandDependencies = {
  session: {
    tenantId?: string;
    organization?: { id: string };
    member: { status: string };
    permissionCodes: readonly string[];
  } | null;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  dispatchNotification?: (scope: {
    tenantId: string;
    organizationId: string;
    notificationId: string;
  }) => Promise<{
    status: "pending" | "sending" | "sent" | "failed" | "unavailable";
    version?: number;
  }>;
  createRequestId?: () => string;
};

const roles = new Set(["manager", "member", "viewer"]);
const publicFailures = new Set([
  "forbidden", "not_found", "stale_version", "conflict", "scope_conflict",
  "invalid_request", "restore_status_required", "invalid_state",
]);

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function statusFor(error: string) {
  if (error === "forbidden") return 403;
  if (error === "not_found") return 404;
  if (["stale_version", "conflict", "scope_conflict", "invalid_state", "restore_status_required"].includes(error)) return 409;
  return error === "invalid_request" ? 400 : 503;
}

function commandAllowed(dependencies: ProjectCommercialCommandDependencies) {
  return dependencies.session?.member.status === "active";
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function positiveInteger(value: unknown, allowZero = false) {
  return typeof value === "number" && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
    ? value : null;
}

function allocation(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    && Math.round(value * 100) === value * 100 ? value : null;
}

function reason(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  return parsed.length >= 1 && parsed.length <= 500 ? parsed : null;
}

async function strictBody(request: Request) {
  const parsed = await readStrictJson(request);
  if (!parsed.ok) {
    return { ok: false, response: json({ error: parsed.error }, parsed.error === "unsupported_media_type" ? 415
      : parsed.error === "payload_too_large" ? 413 : 400) } as const;
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return { ok: false, response: json({ error: "invalid_request" }, 400) } as const;
  }
  return { ok: true, value: parsed.value as Record<string, unknown> } as const;
}

async function invoke(
  name: string,
  args: Record<string, unknown>,
  dependencies: ProjectCommercialCommandDependencies,
) {
  try {
    const result = await dependencies.rpc(name, args);
    if (result.error) {
      if (result.error.code === "42501") return json({ error: "forbidden" }, 403);
      if (result.error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
      return json({ error: "project_command_unavailable" }, 503);
    }
    const row = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as Record<string, unknown> : null;
    if (row?.outcome === "failure" && typeof row.error === "string") {
      const error = publicFailures.has(row.error) ? row.error : "project_command_unavailable";
      return json({ error }, statusFor(error));
    }
    if (row?.outcome !== "success") return json({ error: "project_command_unavailable" }, 503);
    return row;
  } catch {
    return json({ error: "project_command_unavailable" }, 503);
  }
}

function commandIds(request: Request, dependencies: ProjectCommercialCommandDependencies) {
  const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
  if (!idempotencyKey) return null;
  return {
    request_id: dependencies.createRequestId?.() ?? randomUUID(),
    idempotency_key: idempotencyKey,
  };
}

export async function handleProjectMemberCommand(
  request: Request,
  context: Context,
  dependencies: ProjectCommercialCommandDependencies,
  method: "POST" | "DELETE",
) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (!commandAllowed(dependencies)) return json({ error: "forbidden" }, 403);
  const projectId = canonicalUuid((await context.params).projectId);
  const ids = commandIds(request, dependencies);
  if (!projectId) return json({ error: "invalid_request" }, 400);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const parsed = await strictBody(request);
  if (!parsed.ok) return parsed.response;
  const expected = method === "POST"
    ? ["command", "employeePublicId", "role", "allocationPercent", "expectedProjectVersion", "expectedMembershipVersion", "reason"]
    : ["employeePublicId", "expectedProjectVersion", "expectedMembershipVersion", "reason"];
  if (!exactKeys(parsed.value, expected)) return json({ error: "invalid_request" }, 400);
  const command = method === "DELETE" ? "remove" : parsed.value.command;
  const employeePublicId = canonicalUuid(parsed.value.employeePublicId);
  const role = method === "DELETE" ? null : parsed.value.role;
  const allocationPercent = method === "DELETE" ? 0 : allocation(parsed.value.allocationPercent);
  const expectedProjectVersion = positiveInteger(parsed.value.expectedProjectVersion);
  const expectedMembershipVersion = positiveInteger(parsed.value.expectedMembershipVersion, true);
  const businessReason = reason(parsed.value.reason);
  if (!employeePublicId || (method === "POST" && !["add", "change_role"].includes(String(command)))
    || (method === "DELETE" && command !== "remove")
    || (method === "POST" && !roles.has(String(role))) || allocationPercent === null
    || !expectedProjectVersion || expectedMembershipVersion === null || !businessReason) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await invoke("mutate_current_project_member", {
    p_project_public_id: projectId,
    p_employee_public_id: employeePublicId,
    p_command: command,
    p_role: role,
    p_allocation_percent: allocationPercent,
    p_expected_project_version: expectedProjectVersion,
    p_expected_membership_version: expectedMembershipVersion,
    p_reason: businessReason,
    ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  const membershipId = canonicalUuid(entity?.id);
  const resultId = canonicalUuid(result.id);
  const resultVersion = positiveInteger(result.version);
  const resultProjectId = canonicalUuid(entity?.projectId);
  const resultEmployeeId = canonicalUuid(entity?.employeePublicId);
  const membershipVersion = positiveInteger(entity?.version);
  const projectVersion = positiveInteger(entity?.projectVersion);
  const resultRole = typeof entity?.role === "string" && ["manager", "member", "viewer"].includes(entity.role)
    ? entity.role : null;
  const resultAllocation = allocation(entity?.allocationPercent);
  const leftAt = entity?.leftAt === null ? null
    : typeof entity?.leftAt === "string" && Number.isFinite(Date.parse(entity.leftAt)) ? entity.leftAt : undefined;
  if (result.resource !== "project_member" || !membershipId || resultId !== membershipId
    || !membershipVersion || resultVersion !== membershipVersion
    || resultProjectId !== projectId || resultEmployeeId !== employeePublicId
    || !projectVersion || !resultRole || resultAllocation === null
    || leftAt === undefined) {
    return json({ error: "project_command_unavailable" }, 503);
  }
  return json({ outcome: "success", resource: "project_member", id: membershipId,
    version: membershipVersion, projectId, projectVersion, member: {
    id: membershipId, employeePublicId: resultEmployeeId, role: resultRole,
    allocationPercent: resultAllocation, version: membershipVersion, leftAt,
  } });
}

export async function handleProjectRestoreCommand(
  request: Request,
  context: Context,
  dependencies: ProjectCommercialCommandDependencies,
) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (!commandAllowed(dependencies)) return json({ error: "forbidden" }, 403);
  const projectId = canonicalUuid((await context.params).projectId);
  const ids = commandIds(request, dependencies);
  if (!projectId) return json({ error: "invalid_request" }, 400);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const parsed = await strictBody(request);
  if (!parsed.ok) return parsed.response;
  if (!exactKeys(parsed.value, ["expectedVersion", "restoreStatus", "reason"])) {
    return json({ error: "invalid_request" }, 400);
  }
  const expectedVersion = positiveInteger(parsed.value.expectedVersion);
  const restoreStatus = parsed.value.restoreStatus === null ? null
    : typeof parsed.value.restoreStatus === "string" && ["planning", "active", "on_hold", "completed"].includes(parsed.value.restoreStatus)
      ? parsed.value.restoreStatus : undefined;
  const businessReason = reason(parsed.value.reason);
  if (!expectedVersion || restoreStatus === undefined || !businessReason) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await invoke("restore_current_project", {
    p_project_public_id: projectId, p_expected_version: expectedVersion,
    p_restore_status: restoreStatus, p_reason: businessReason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  const id = canonicalUuid(entity?.id);
  const version = positiveInteger(entity?.version);
  if (id !== projectId || !version || typeof entity?.status !== "string"
    || !["planning", "active", "on_hold", "completed"].includes(entity.status)) {
    return json({ error: "project_command_unavailable" }, 503);
  }
  return json({ outcome: "success", id, version, status: entity.status });
}

export async function handleNotificationReadCommand(
  request: Request,
  context: NotificationContext,
  dependencies: ProjectCommercialCommandDependencies,
) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (dependencies.session.member.status !== "active") return json({ error: "forbidden" }, 403);
  const notificationId = canonicalUuid((await context.params).notificationId);
  const requestId = canonicalUuid(request.headers.get("Idempotency-Key"));
  if (!notificationId || !requestId) return json({ error: "invalid_request" }, 400);
  const parsed = await strictBody(request);
  if (!parsed.ok) return parsed.response;
  if (!exactKeys(parsed.value, [])) return json({ error: "invalid_request" }, 400);
  const result = await invoke("mark_current_task_notification_read", {
    p_notification_public_id: notificationId, p_request_id: requestId,
  }, dependencies);
  if (result instanceof Response) return result;
  const id = canonicalUuid(result.id);
  const version = positiveInteger(result.version);
  const readAt = typeof result.readAt === "string" && Number.isFinite(Date.parse(result.readAt))
    ? result.readAt : null;
  if (id !== notificationId || result.state !== "read" || !readAt || !version) {
    return json({ error: "project_command_unavailable" }, 503);
  }
  return json({ outcome: "success", id, state: "read", readAt, version });
}

export async function handleNotificationRetryCommand(
  request: Request,
  context: NotificationContext,
  dependencies: ProjectCommercialCommandDependencies,
) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (!commandAllowed(dependencies)) return json({ error: "forbidden" }, 403);
  const notificationId = canonicalUuid((await context.params).notificationId);
  const ids = commandIds(request, dependencies);
  if (!notificationId || !ids) return json({ error: "invalid_request" }, 400);
  const parsed = await strictBody(request);
  if (!parsed.ok) return parsed.response;
  if (!exactKeys(parsed.value, ["expectedVersion", "reason"])) {
    return json({ error: "invalid_request" }, 400);
  }
  const expectedVersion = positiveInteger(parsed.value.expectedVersion);
  const businessReason = reason(parsed.value.reason);
  if (!expectedVersion || !businessReason) return json({ error: "invalid_request" }, 400);

  const result = await invoke("retry_current_task_notification", {
    p_notification_public_id: notificationId,
    p_expected_version: expectedVersion,
    p_reason: businessReason,
    ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  const id = canonicalUuid(entity?.id);
  const authorizedVersion = positiveInteger(entity?.version);
  if (id !== notificationId || !authorizedVersion) {
    return json({ error: "project_command_unavailable" }, 503);
  }

  let delivery: {
    status: "pending" | "sending" | "sent" | "failed" | "unavailable";
    version?: number;
  } = { status: "unavailable" };
  const tenantId = dependencies.session.tenantId;
  const organizationId = dependencies.session.organization?.id;
  if (dependencies.dispatchNotification && tenantId && organizationId) {
    try {
      delivery = await dependencies.dispatchNotification({ tenantId, organizationId, notificationId });
    } catch {
      // The retry authorization has already returned the durable row to pending.
      // A later worker or explicit retry can resume without losing the command.
    }
  }

  let version = authorizedVersion;
  let state: "pending" | "sending" | "sent" | "failed" = delivery.status === "sent"
    ? "sent" : delivery.status === "failed" ? "failed" : "pending";
  const deliveryVersion = positiveInteger(delivery.version);
  if (deliveryVersion && delivery.status !== "unavailable") {
    version = deliveryVersion;
    state = delivery.status;
  }
  try {
    const inbox = await dependencies.rpc("current_task_notification_inbox", {});
    if (!inbox.error && Array.isArray(inbox.data)) {
      const current = inbox.data.find((candidate) => {
        const row = candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? candidate as Record<string, unknown> : null;
        return canonicalUuid(row?.notification_public_id) === notificationId;
      }) as Record<string, unknown> | undefined;
      const currentVersion = positiveInteger(current?.version);
      const currentState = current?.effective_status;
      if (currentVersion && typeof currentState === "string"
        && ["pending", "sending", "sent", "failed"].includes(currentState)) {
        version = currentVersion;
        state = currentState as typeof state;
      }
    }
  } catch {
    // Delivery state remains explicit and the page refresh will reconcile it.
  }
  return json({ outcome: "success", id, version, state, delivery });
}
