import { randomUUID } from "node:crypto";

import { canonicalUuid, readStrictJson } from "@/app/api/workstation/tasks/handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { dispatchTaskAssignedNotification, type TaskNotificationScope } from "@/features/workstation/task-notification";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type Dependencies = {
  loadSession: () => Promise<{ tenantId: string; organization: { id: string }; member: { status: string }; permissionCodes: readonly string[] } | null>;
  authorizeRetry: (taskId: string, reason: string, requestId: string, idempotencyKey: string) => Promise<unknown>;
  notifyTask: (scope: TaskNotificationScope) => ReturnType<typeof dispatchTaskAssignedNotification>;
  createRequestId?: () => string;
};

export const defaultTaskNotificationRetryDependencies: Dependencies = {
  loadSession: getWorkspaceSession,
  async authorizeRetry(taskId, reason, requestId, idempotencyKey) {
    const client = await getSupabaseServerClient();
    const { data, error } = await client.rpc("retry_current_task_assigned_notification", {
      p_task_public_id: taskId, p_reason: reason, request_id: requestId, idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    return data;
  },
  notifyTask: dispatchTaskAssignedNotification,
};

function response(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function createTaskNotificationRetryHandler(dependencies: Dependencies) {
  return async function retry(request: Request, context: { params: Promise<{ taskId: string }> }) {
    const session = await dependencies.loadSession();
    if (!session) return response("unauthorized", 401);
    if (session.member.status !== "active") {
      return response("forbidden", 403);
    }
    const taskId = canonicalUuid((await context.params).taskId);
    const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
    if (!taskId || !idempotencyKey) return response("invalid_request", 400);
    const parsed = await readStrictJson(request);
    if (!parsed.ok) return response(parsed.error, parsed.error === "unsupported_media_type" ? 415 : parsed.error === "payload_too_large" ? 413 : 400);
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return response("invalid_request", 400);
    const body = parsed.value as Record<string, unknown>;
    if (Object.keys(body).length !== 1 || typeof body.reason !== "string"
      || body.reason.trim().length < 1 || body.reason.trim().length > 500) {
      return response("invalid_request", 400);
    }
    let authorization: unknown;
    try {
      authorization = await dependencies.authorizeRetry(taskId, body.reason.trim(), dependencies.createRequestId?.() ?? randomUUID(), idempotencyKey);
    } catch { return response("notification_authorization_unavailable", 503); }
    if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) return response("notification_authorization_unavailable", 503);
    const result = authorization as Record<string, unknown>;
    if (result.outcome === "failure") {
      const error = typeof result.error === "string" ? result.error : "notification_authorization_unavailable";
      return response(error === "not_found" ? error : error === "forbidden" ? error : error === "stale_version" || error === "conflict" ? error : "notification_authorization_unavailable",
        error === "not_found" ? 404 : error === "forbidden" ? 403 : error === "stale_version" || error === "conflict" ? 409 : 503);
    }
    const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
      ? result.entity as Record<string, unknown> : null;
    if (result.outcome !== "success" || result.resource !== "task_notification"
      || canonicalUuid(entity?.taskId) !== taskId) {
      return response("notification_authorization_unavailable", 503);
    }
    try {
      const notification = await dependencies.notifyTask({
        tenantId: session.tenantId, organizationId: session.organization.id, taskId,
      });
      return Response.json({ notification }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json(
        { notification: { status: "unavailable", errorCode: "queue_unavailable" } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}
