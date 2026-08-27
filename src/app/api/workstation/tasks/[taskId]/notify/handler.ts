import { getWorkspaceSession } from "@/features/auth/workspace-session";
import {
  dispatchTaskAssignedNotification,
  type TaskNotificationScope,
} from "@/features/workstation/task-notification";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TaskNotifySession = {
  tenantId: string;
  organization: { id: string };
  permissionCodes: readonly string[];
};

export type WorkstationTaskNotifyDependencies = {
  loadSession: () => Promise<TaskNotifySession | null>;
  authorizeTask: (taskId: string) => Promise<boolean>;
  notifyTask: (
    scope: TaskNotificationScope,
  ) => ReturnType<typeof dispatchTaskAssignedNotification>;
};

export const defaultWorkstationTaskNotifyDependencies: WorkstationTaskNotifyDependencies = {
  loadSession: getWorkspaceSession,
  async authorizeTask(taskId) {
    const client = await getSupabaseServerClient();
    const { data, error } = await client.rpc("authorize_current_task_notification_retry", {
      p_task_public_id: taskId,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("notification_authorization_unavailable");
    }
    const result = data as Record<string, unknown>;
    if (result.outcome === "failure" && result.error === "not_found") return false;
    if (result.outcome === "success" && typeof result.taskId === "string"
        && result.taskId.toLowerCase() === taskId.toLowerCase()) return true;
    throw new Error("notification_authorization_unavailable");
  },
  notifyTask: dispatchTaskAssignedNotification,
};

export function createWorkstationTaskNotifyHandler(
  dependencies: WorkstationTaskNotifyDependencies,
) {
  return async function notify(
    _request: Request,
    context: { params: Promise<{ taskId: string }> },
  ) {
    const session = await dependencies.loadSession();
    if (!session) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!session.permissionCodes.includes("task.manage")) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    const { taskId } = await context.params;
    if (!UUID_PATTERN.test(taskId)) {
      return Response.json({ error: "invalid_task" }, { status: 400 });
    }

    try {
      if (!await dependencies.authorizeTask(taskId)) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
    } catch {
      return Response.json(
        { error: "notification_authorization_unavailable" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    try {
      const notification = await dependencies.notifyTask({
        tenantId: session.tenantId,
        organizationId: session.organization.id,
        taskId,
      });
      return Response.json(
        { notification },
        { headers: { "cache-control": "no-store" } },
      );
    } catch {
      return Response.json(
        { error: "notification_retry_failed" },
        {
          status: 502,
          headers: { "cache-control": "no-store" },
        },
      );
    }
  };
}
