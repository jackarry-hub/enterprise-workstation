import { createClient } from "@supabase/supabase-js";

import {
  getFeishuTaskNotificationEnv,
  sendFeishuTaskNotification,
  type FeishuTaskNotificationInput,
} from "@/features/feishu/task-notification";
import { getSupabaseEnv } from "@/lib/supabase/env";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TaskNotificationScope = {
  tenantId: string;
  organizationId: string;
  taskId: string;
};

export type TaskNotificationErrorCode =
  | "token_unavailable"
  | "recipient_unavailable"
  | "send_failed"
  | "configuration_unavailable"
  | "queue_unavailable"
  | "delivery_unconfirmed";

export type TaskNotificationDeliveryClaim =
  | { action: "sent"; notificationId: string; messageId: string }
  | { action: "in_progress"; notificationId: string }
  | {
      action: "finalize";
      notificationId: string;
      attemptToken: string;
      providerRequestId: string;
      leaseToken: string;
      leaseGeneration: number;
      messageId: string;
    }
  | {
      action: "send";
      notificationId: string;
      attemptToken: string;
      providerRequestId: string;
      leaseToken: string;
      leaseGeneration: number;
      isFresh: boolean;
      attemptCount: number;
      recipientOpenId: string | null;
      taskId: string;
      taskTitle: string;
      projectName: string;
      reporterName: string;
      priority: string;
      dueDate: string;
      acceptanceCriteria: string;
    };

type TaskNotificationResult =
  | { status: "sent" }
  | { status: "failed"; errorCode: TaskNotificationErrorCode }
  | { status: "unavailable"; errorCode: TaskNotificationErrorCode };

type FailureRecordResult =
  | { state: "failed" }
  | { state: "provider_accepted" | "sent"; messageId: string };

export type TaskNotificationDependencies = {
  createAttemptToken: () => string;
  claim: (scope: TaskNotificationScope, attemptToken: string) => Promise<TaskNotificationDeliveryClaim | null>;
  sendMessage: (
    input: FeishuTaskNotificationInput,
    providerRequestId: string,
  ) => Promise<{ messageId: string }>;
  recordProviderAcceptance: (
    scope: TaskNotificationScope,
    claim: Extract<TaskNotificationDeliveryClaim, { action: "send" }>,
    messageId: string,
  ) => Promise<void>;
  complete: (
    scope: TaskNotificationScope,
    notificationId: string,
    attemptToken: string,
    leaseToken: string,
    leaseGeneration: number,
  ) => Promise<void>;
  fail: (
    scope: TaskNotificationScope,
    claim: Extract<TaskNotificationDeliveryClaim, { action: "send" }>,
    errorCode: TaskNotificationErrorCode,
  ) => Promise<FailureRecordResult>;
};

function safeText(value: unknown, maximum = 1000) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function parseDeliveryClaim(value: unknown, scope: TaskNotificationScope): TaskNotificationDeliveryClaim | null | "invalid" {
  const source = object(value);
  if (!source) return "invalid";
  if (source.outcome === "failure" && source.error === "not_found") return null;
  if (source.outcome !== "success") return "invalid";
  const notificationId = uuid(source.notificationId);
  if (!notificationId) return "invalid";
  if (source.action === "sent") {
    const messageId = safeText(source.messageId, 512);
    return messageId ? { action: "sent", notificationId, messageId } : "invalid";
  }
  if (source.action === "in_progress") return { action: "in_progress", notificationId };
  const attemptToken = uuid(source.attemptToken);
  const providerRequestId = uuid(source.providerRequestId);
  const leaseToken = uuid(source.leaseToken);
  const leaseGeneration = source.leaseGeneration;
  if (!attemptToken || !providerRequestId || !leaseToken
      || !Number.isSafeInteger(leaseGeneration) || Number(leaseGeneration) < 1) return "invalid";
  if (source.action === "finalize") {
    const messageId = safeText(source.messageId, 512);
    return messageId
      ? {
          action: "finalize", notificationId, attemptToken, providerRequestId,
          leaseToken, leaseGeneration: Number(leaseGeneration), messageId,
        }
      : "invalid";
  }
  if (source.action !== "send") return "invalid";
  const taskId = uuid(source.taskId);
  const taskTitle = safeText(source.taskTitle);
  const projectName = safeText(source.projectName);
  const reporterName = safeText(source.reporterName);
  const priority = safeText(source.priority, 80);
  const acceptanceCriteria = safeText(source.acceptanceCriteria, 4000);
  const recipientOpenId = source.recipientOpenId == null ? null : safeText(source.recipientOpenId, 200);
  const dueDate = source.dueDate == null ? "无截止日期" : safeText(source.dueDate, 80);
  if (!taskId || taskId !== scope.taskId.toLowerCase() || !taskTitle || !projectName
      || !reporterName || !priority || !dueDate || !acceptanceCriteria
      || !["low", "medium", "high", "urgent"].includes(priority)
      || (source.recipientOpenId != null && !recipientOpenId)
      || typeof source.isFresh !== "boolean"
      || !Number.isSafeInteger(source.attemptCount) || Number(source.attemptCount) < 1) return "invalid";
  return {
    action: "send", notificationId, attemptToken, providerRequestId,
    leaseToken, leaseGeneration: Number(leaseGeneration),
    isFresh: source.isFresh, attemptCount: Number(source.attemptCount),
    recipientOpenId, taskId, taskTitle, projectName, reporterName,
    priority, dueDate, acceptanceCriteria,
  };
}

function stableNotificationError(error: unknown): TaskNotificationErrorCode {
  const code = error instanceof Error ? error.message : "";
  return code === "token_unavailable"
      || code === "configuration_unavailable"
      || code === "recipient_unavailable"
      || code === "delivery_unconfirmed"
    ? code
    : "send_failed";
}

function messageInput(claim: Extract<TaskNotificationDeliveryClaim, { action: "send" }>, recipientOpenId: string) {
  return {
    taskId: claim.taskId,
    recipientOpenId,
    taskTitle: claim.taskTitle,
    projectName: claim.projectName,
    reporterName: claim.reporterName,
    priority: claim.priority,
    dueDate: claim.dueDate,
    acceptanceCriteria: claim.acceptanceCriteria,
  } satisfies FeishuTaskNotificationInput;
}

function logDeliveryFailure(
  scope: TaskNotificationScope,
  notificationId: string,
  attemptCount: number,
  errorCode: TaskNotificationErrorCode,
) {
  console.error({ taskId: scope.taskId, notificationId, attemptCount, errorCode });
}

export function createTaskNotificationDispatcher(dependencies: TaskNotificationDependencies) {
  const inFlightOperations = new Map<string, Promise<TaskNotificationResult>>();

  async function finalize(
    scope: TaskNotificationScope,
    notificationId: string,
    attemptToken: string,
    leaseToken: string,
    leaseGeneration: number,
  ): Promise<TaskNotificationResult> {
    try {
      await dependencies.complete(scope, notificationId, attemptToken, leaseToken, leaseGeneration);
      return { status: "sent" };
    } catch {
      return { status: "unavailable", errorCode: "delivery_unconfirmed" };
    }
  }

  async function performDispatch(scope: TaskNotificationScope): Promise<TaskNotificationResult> {
    let claim: TaskNotificationDeliveryClaim | null;
    try {
      claim = await dependencies.claim(scope, dependencies.createAttemptToken());
    } catch (error) {
      return {
        status: "unavailable",
        errorCode: error instanceof Error && error.message === "configuration_unavailable"
          ? "configuration_unavailable"
          : "queue_unavailable",
      };
    }
    if (!claim) return { status: "unavailable", errorCode: "recipient_unavailable" };
    if (claim.action === "sent") return { status: "sent" };
    if (claim.action === "in_progress") {
      return { status: "unavailable", errorCode: "delivery_unconfirmed" };
    }
    if (claim.action === "finalize") {
      return finalize(
        scope, claim.notificationId, claim.attemptToken,
        claim.leaseToken, claim.leaseGeneration,
      );
    }

    const recipientOpenId = claim.recipientOpenId?.trim();
    if (!recipientOpenId) {
      try {
        await dependencies.fail(scope, claim, "recipient_unavailable");
      } catch {
        logDeliveryFailure(scope, claim.notificationId, claim.attemptCount, "queue_unavailable");
        return { status: "unavailable", errorCode: "queue_unavailable" };
      }
      logDeliveryFailure(scope, claim.notificationId, claim.attemptCount, "recipient_unavailable");
      return { status: "unavailable", errorCode: "recipient_unavailable" };
    }

    let messageId: string;
    try {
      ({ messageId } = await dependencies.sendMessage(
        messageInput(claim, recipientOpenId),
        claim.providerRequestId,
      ));
    } catch (error) {
      const errorCode = stableNotificationError(error);
      if (errorCode === "delivery_unconfirmed") {
        logDeliveryFailure(scope, claim.notificationId, claim.attemptCount, errorCode);
        return { status: "unavailable", errorCode };
      }
      try {
        const failed = await dependencies.fail(scope, claim, errorCode);
        if (failed.state === "provider_accepted") {
          return finalize(
            scope, claim.notificationId, claim.attemptToken,
            claim.leaseToken, claim.leaseGeneration,
          );
        }
        if (failed.state === "sent") return { status: "sent" };
      } catch {
        logDeliveryFailure(scope, claim.notificationId, claim.attemptCount, "queue_unavailable");
        return { status: "failed", errorCode: "queue_unavailable" };
      }
      logDeliveryFailure(scope, claim.notificationId, claim.attemptCount, errorCode);
      return { status: "failed", errorCode };
    }

    try {
      await dependencies.recordProviderAcceptance(scope, claim, messageId);
    } catch {
      logDeliveryFailure(scope, claim.notificationId, claim.attemptCount, "delivery_unconfirmed");
      return { status: "unavailable", errorCode: "delivery_unconfirmed" };
    }
    return finalize(
      scope, claim.notificationId, claim.attemptToken,
      claim.leaseToken, claim.leaseGeneration,
    );
  }

  return function dispatch(scope: TaskNotificationScope): Promise<TaskNotificationResult> {
    const key = [scope.tenantId, scope.organizationId, scope.taskId].join(":");
    const existing = inFlightOperations.get(key);
    if (existing) return existing;
    const operation = performDispatch(scope).finally(() => {
      if (inFlightOperations.get(key) === operation) inFlightOperations.delete(key);
    });
    inFlightOperations.set(key, operation);
    return operation;
  };
}

function adminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("configuration_unavailable");
  try {
    const { url } = getSupabaseEnv();
    return createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    throw new Error("configuration_unavailable");
  }
}

export async function callTaskNotificationRpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await adminClient().rpc(name, parameters);
  if (error) throw new Error("notification_queue_unavailable");
  const result = object(data);
  if (!result) throw new Error("notification_queue_unavailable");
  return result;
}

export async function callTaskNotificationRowsRpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await adminClient().rpc(name, parameters);
  if (error || !Array.isArray(data)) throw new Error("notification_queue_unavailable");
  const rows = data.map(object);
  if (rows.some((row) => !row)) throw new Error("notification_queue_unavailable");
  return rows as Record<string, unknown>[];
}

function successfulState(value: unknown, allowed: string[]) {
  const result = object(value);
  if (!result || result.outcome !== "success" || typeof result.state !== "string"
      || !allowed.includes(result.state)) {
    throw new Error("notification_queue_unavailable");
  }
  return result;
}

export const defaultTaskNotificationDependencies: TaskNotificationDependencies = {
  createAttemptToken: () => crypto.randomUUID(),
  async claim(scope, attemptToken) {
    const result = await callTaskNotificationRpc("claim_task_notification_delivery_v2", {
      p_tenant_public_id: scope.tenantId,
      p_organization_public_id: scope.organizationId,
      p_task_public_id: scope.taskId,
      p_attempt_token: attemptToken,
    });
    const parsed = parseDeliveryClaim(result, scope);
    if (parsed === "invalid") throw new Error("notification_queue_unavailable");
    return parsed;
  },
  sendMessage(input, providerRequestId) {
    return sendFeishuTaskNotification(input, getFeishuTaskNotificationEnv(), {
      idempotencyKey: providerRequestId,
    });
  },
  async recordProviderAcceptance(scope, claim, messageId) {
    successfulState(await callTaskNotificationRpc("record_task_notification_provider_acceptance_v2", {
      p_tenant_public_id: scope.tenantId,
      p_organization_public_id: scope.organizationId,
      p_notification_public_id: claim.notificationId,
      p_attempt_token: claim.attemptToken,
      p_lease_token: claim.leaseToken,
      p_lease_generation: claim.leaseGeneration,
      p_provider_request_id: claim.providerRequestId,
      p_provider_message_id: messageId,
    }), ["provider_accepted", "sent"]);
  },
  async complete(scope, notificationId, attemptToken, leaseToken, leaseGeneration) {
    successfulState(await callTaskNotificationRpc("complete_task_notification_delivery_v2", {
      p_tenant_public_id: scope.tenantId,
      p_organization_public_id: scope.organizationId,
      p_notification_public_id: notificationId,
      p_attempt_token: attemptToken,
      p_lease_token: leaseToken,
      p_lease_generation: leaseGeneration,
    }), ["sent"]);
  },
  async fail(scope, claim, errorCode) {
    const result = successfulState(await callTaskNotificationRpc("fail_task_notification_delivery_v2", {
      p_tenant_public_id: scope.tenantId,
      p_organization_public_id: scope.organizationId,
      p_notification_public_id: claim.notificationId,
      p_attempt_token: claim.attemptToken,
      p_lease_token: claim.leaseToken,
      p_lease_generation: claim.leaseGeneration,
      p_error_code: errorCode,
    }), ["failed", "provider_accepted", "sent"]);
    if (result.state === "provider_accepted" || result.state === "sent") {
      const messageId = safeText(result.messageId, 512);
      if (!messageId) throw new Error("notification_queue_unavailable");
      return { state: result.state, messageId };
    }
    return { state: "failed" };
  },
};

export const dispatchTaskAssignedNotification =
  createTaskNotificationDispatcher(defaultTaskNotificationDependencies);
