import { getFeishuTaskNotificationEnv, sendFeishuTaskEventNotification, type FeishuTaskEventNotificationInput } from "@/features/feishu/task-notification";
import { callTaskNotificationRpc, type TaskNotificationErrorCode, type TaskNotificationScope } from "@/features/workstation/task-notification";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type EventType = FeishuTaskEventNotificationInput["eventType"];
type EventScope = Omit<TaskNotificationScope, "taskId"> & { notificationId: string };
export type TaskEventDeliveryResult = {
  status: "pending" | "sending" | "sent" | "failed" | "unavailable";
  version?: number;
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function text(value: unknown, maximum = 4000) {
  return typeof value === "string" && value.trim().length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim() : null;
}

function success(value: unknown, states: readonly string[]) {
  const row = record(value);
  if (!row || row.outcome !== "success" || typeof row.state !== "string" || !states.includes(row.state)) {
    throw new Error("notification_queue_unavailable");
  }
  return row;
}

async function complete(scope: EventScope, claim: Record<string, unknown>) {
  success(await callTaskNotificationRpc("complete_task_notification_delivery_v2", {
    p_tenant_public_id: scope.tenantId, p_organization_public_id: scope.organizationId,
    p_notification_public_id: scope.notificationId, p_attempt_token: claim.attemptToken,
    p_lease_token: claim.leaseToken, p_lease_generation: claim.leaseGeneration,
  }), ["sent"]);
}

async function fail(scope: EventScope, claim: Record<string, unknown>, errorCode: TaskNotificationErrorCode) {
  return success(await callTaskNotificationRpc("fail_task_notification_delivery_v2", {
    p_tenant_public_id: scope.tenantId, p_organization_public_id: scope.organizationId,
    p_notification_public_id: scope.notificationId, p_attempt_token: claim.attemptToken,
    p_lease_token: claim.leaseToken, p_lease_generation: claim.leaseGeneration,
    p_error_code: errorCode,
  }), ["failed", "provider_accepted", "sent"]);
}

async function deliveryState(scope: EventScope): Promise<TaskEventDeliveryResult> {
  const result = await callTaskNotificationRpc("task_notification_delivery_state_v1", {
    p_tenant_public_id: scope.tenantId,
    p_organization_public_id: scope.organizationId,
    p_notification_public_id: scope.notificationId,
  });
  const notificationId = uuid(result.notificationId);
  const version = result.version;
  const status = result.status;
  if (result.outcome !== "success" || notificationId !== scope.notificationId.toLowerCase()
    || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1
    || typeof status !== "string" || !["pending", "sending", "sent", "failed"].includes(status)) {
    throw new Error("notification_queue_unavailable");
  }
  return { status: status as Exclude<TaskEventDeliveryResult["status"], "unavailable">, version };
}

export async function dispatchTaskEventNotification(scope: EventScope): Promise<TaskEventDeliveryResult> {
  const claim = await callTaskNotificationRpc("claim_task_notification_event_delivery_v3", {
    p_tenant_public_id: scope.tenantId, p_organization_public_id: scope.organizationId,
    p_notification_public_id: scope.notificationId, p_attempt_token: crypto.randomUUID(),
  });
  if (claim.outcome === "failure") return { status: "unavailable" };
  if (uuid(claim.notificationId) !== scope.notificationId.toLowerCase()) {
    throw new Error("notification_queue_unavailable");
  }
  if (claim.action === "sent" || claim.action === "in_progress") return deliveryState(scope);
  if (claim.action === "finalize") {
    await complete(scope, claim);
    return deliveryState(scope);
  }
  const eventType = typeof claim.eventType === "string" && ["task.assigned", "task.submitted", "task.review_passed", "task.review_rejected", "task.reopened"].includes(claim.eventType)
    ? claim.eventType as EventType : null;
  const recipientOpenId = text(claim.recipientOpenId, 200);
  const taskId = uuid(claim.taskId);
  const taskTitle = text(claim.taskTitle, 1000);
  const projectName = text(claim.projectName, 1000);
  const actorName = text(claim.actorName, 1000);
  const reviewNote = text(claim.reviewNote) ?? "";
  const attemptToken = uuid(claim.attemptToken);
  const providerRequestId = uuid(claim.providerRequestId);
  const leaseToken = uuid(claim.leaseToken);
  if (claim.action !== "send" || !eventType || !taskId || !taskTitle || !projectName || !actorName
    || !attemptToken || !providerRequestId || !leaseToken || !Number.isSafeInteger(claim.leaseGeneration)) {
    throw new Error("notification_queue_unavailable");
  }
  if (!recipientOpenId) {
    await fail(scope, claim, "recipient_unavailable");
    return deliveryState(scope);
  }
  let messageId: string;
  try {
    ({ messageId } = await sendFeishuTaskEventNotification({
      taskId, recipientOpenId, eventType, taskTitle, projectName, actorName, reviewNote,
    }, getFeishuTaskNotificationEnv(), { idempotencyKey: providerRequestId }));
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : "";
    const code: TaskNotificationErrorCode = rawCode === "delivery_unconfirmed"
      || rawCode === "configuration_unavailable" || rawCode === "token_unavailable"
      ? rawCode : "send_failed";
    if (code === "delivery_unconfirmed") return deliveryState(scope);
    const failed = await fail(scope, claim, code);
    if (failed.state === "provider_accepted") await complete(scope, claim);
    return deliveryState(scope);
  }
  success(await callTaskNotificationRpc("record_task_notification_provider_acceptance_v2", {
    p_tenant_public_id: scope.tenantId, p_organization_public_id: scope.organizationId,
    p_notification_public_id: scope.notificationId, p_attempt_token: attemptToken,
    p_lease_token: leaseToken, p_lease_generation: claim.leaseGeneration,
    p_provider_request_id: providerRequestId, p_provider_message_id: messageId,
  }), ["provider_accepted", "sent"]);
  await complete(scope, claim);
  return deliveryState(scope);
}

export async function dispatchPendingTaskEventNotifications(scope: TaskNotificationScope) {
  const result = await callTaskNotificationRpc("pending_task_notification_events_for_delivery", {
    p_tenant_public_id: scope.tenantId, p_organization_public_id: scope.organizationId,
    p_task_public_id: scope.taskId,
  });
  if (result.outcome !== "success" || !Array.isArray(result.notificationIds)) {
    throw new Error("notification_queue_unavailable");
  }
  const ids = result.notificationIds.map(uuid);
  if (ids.some((id) => !id)) throw new Error("notification_queue_unavailable");
  return Promise.all((ids as string[]).map((notificationId) => dispatchTaskEventNotification({
    tenantId: scope.tenantId, organizationId: scope.organizationId, notificationId,
  })));
}
