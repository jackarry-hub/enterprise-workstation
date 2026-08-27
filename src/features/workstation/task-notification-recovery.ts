import { dispatchTaskEventNotification } from "@/features/workstation/task-event-notification";
import { callTaskNotificationRowsRpc } from "@/features/workstation/task-notification";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export type TaskNotificationRecoveryResult = {
  claimed: number;
  sent: number;
  pending: number;
  failed: number;
  unavailable: number;
};

export async function runDefaultTaskNotificationRecovery(limit = 50): Promise<TaskNotificationRecoveryResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("notification_recovery_invalid_limit");
  }
  const rows = await callTaskNotificationRowsRpc("due_task_notifications_for_delivery", {
    p_limit: limit,
  });
  const scopes = rows.map((row) => ({
    tenantId: uuid(row.tenant_public_id),
    organizationId: uuid(row.organization_public_id),
    notificationId: uuid(row.notification_public_id),
  }));
  if (scopes.some((scope) => !scope.tenantId || !scope.organizationId || !scope.notificationId)) {
    throw new Error("notification_queue_unavailable");
  }
  const result: TaskNotificationRecoveryResult = {
    claimed: scopes.length, sent: 0, pending: 0, failed: 0, unavailable: 0,
  };
  for (const scope of scopes) {
    try {
      const delivery = await dispatchTaskEventNotification({
        tenantId: scope.tenantId!,
        organizationId: scope.organizationId!,
        notificationId: scope.notificationId!,
      });
      if (delivery.status === "sent") result.sent += 1;
      else if (delivery.status === "failed") result.failed += 1;
      else if (delivery.status === "pending" || delivery.status === "sending") result.pending += 1;
      else result.unavailable += 1;
    } catch {
      result.unavailable += 1;
    }
  }
  return result;
}
