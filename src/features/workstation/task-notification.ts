import { createClient } from "@supabase/supabase-js";

import {
  getFeishuTaskNotificationEnv,
  sendFeishuTaskNotification,
  type FeishuTaskNotificationInput,
} from "@/features/feishu/task-notification";
import { getSupabaseEnv } from "@/lib/supabase/env";

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

type TaskNotificationContext = Omit<
  FeishuTaskNotificationInput,
  "recipientOpenId"
> & {
  notificationId: string;
  recipientOpenId: string | null;
  status: "pending" | "sent" | "failed";
  attemptCount: number;
};

type TaskNotificationResult =
  | { status: "sent" }
  | { status: "failed"; errorCode: TaskNotificationErrorCode }
  | { status: "unavailable"; errorCode: TaskNotificationErrorCode };

type TaskNotificationRecordResult =
  | { status: "sent"; messageId: string }
  | { status: "failed"; errorCode: TaskNotificationErrorCode };

type TaskNotificationDependencies = {
  loadContext: (
    scope: TaskNotificationScope,
  ) => Promise<TaskNotificationContext | null>;
  sendMessage: (
    input: FeishuTaskNotificationInput,
  ) => Promise<{ messageId: string }>;
  recordResult: (
    scope: TaskNotificationScope,
    notificationId: string,
    result: TaskNotificationRecordResult,
  ) => Promise<void>;
};

type TaskNotificationContextRow = {
  notification_public_id: string;
  task_public_id: string;
  recipient_open_id: string | null;
  task_title: string;
  project_name: string;
  reporter_name: string;
  priority: string;
  due_date: string | null;
  acceptance_criteria: string;
  status: "pending" | "sent" | "failed";
  attempt_count: number;
};

function stableNotificationError(error: unknown): TaskNotificationErrorCode {
  const code = error instanceof Error ? error.message : "";
  return code === "token_unavailable"
      || code === "configuration_unavailable"
      || code === "recipient_unavailable"
    ? code
    : "send_failed";
}

function stableQueueError(error: unknown): TaskNotificationErrorCode {
  return error instanceof Error && error.message === "configuration_unavailable"
    ? "configuration_unavailable"
    : "queue_unavailable";
}

function messageInput(
  context: TaskNotificationContext,
  recipientOpenId: string,
): FeishuTaskNotificationInput {
  return {
    taskId: context.taskId,
    recipientOpenId,
    taskTitle: context.taskTitle,
    projectName: context.projectName,
    reporterName: context.reporterName,
    priority: context.priority,
    dueDate: context.dueDate,
    acceptanceCriteria: context.acceptanceCriteria,
  };
}

function logDeliveryFailure(
  scope: TaskNotificationScope,
  context: TaskNotificationContext,
  errorCode: TaskNotificationErrorCode,
) {
  console.error({
    taskId: scope.taskId,
    notificationId: context.notificationId,
    attemptCount: context.attemptCount + 1,
    errorCode,
  });
}

export function createTaskNotificationDispatcher(
  dependencies: TaskNotificationDependencies,
) {
  const unconfirmedDeliveries = new Map<string, string>();
  const inFlightOperations = new Map<
    string,
    Promise<TaskNotificationResult>
  >();

  async function performDispatch(
    scope: TaskNotificationScope,
  ): Promise<TaskNotificationResult> {
    let context: TaskNotificationContext | null;
    try {
      context = await dependencies.loadContext(scope);
    } catch (error) {
      return {
        status: "unavailable",
        errorCode: stableQueueError(error),
      };
    }

    if (!context) {
      return {
        status: "unavailable",
        errorCode: "recipient_unavailable",
      };
    }
    const reconciliationKey = [
      scope.tenantId,
      scope.organizationId,
      context.notificationId,
    ].join(":");
    if (context.status === "sent") {
      unconfirmedDeliveries.delete(reconciliationKey);
      return { status: "sent" };
    }

    const unconfirmedMessageId = unconfirmedDeliveries.get(reconciliationKey);
    if (unconfirmedMessageId) {
      try {
        await dependencies.recordResult(scope, context.notificationId, {
          status: "sent",
          messageId: unconfirmedMessageId,
        });
        unconfirmedDeliveries.delete(reconciliationKey);
        return { status: "sent" };
      } catch {
        logDeliveryFailure(scope, context, "delivery_unconfirmed");
        return {
          status: "unavailable",
          errorCode: "delivery_unconfirmed",
        };
      }
    }

    const recipientOpenId = context.recipientOpenId?.trim();
    if (!recipientOpenId) {
      try {
        await dependencies.recordResult(scope, context.notificationId, {
          status: "failed",
          errorCode: "recipient_unavailable",
        });
      } catch {
        logDeliveryFailure(scope, context, "queue_unavailable");
        return {
          status: "unavailable",
          errorCode: "queue_unavailable",
        };
      }
      logDeliveryFailure(scope, context, "recipient_unavailable");
      return {
        status: "unavailable",
        errorCode: "recipient_unavailable",
      };
    }

    let result: { messageId: string };
    try {
      result = await dependencies.sendMessage(
        messageInput(context, recipientOpenId),
      );
    } catch (error) {
      const errorCode = stableNotificationError(error);
      try {
        await dependencies.recordResult(scope, context.notificationId, {
          status: "failed",
          errorCode,
        });
      } catch {
        logDeliveryFailure(scope, context, "queue_unavailable");
        return { status: "failed", errorCode: "queue_unavailable" };
      }
      logDeliveryFailure(scope, context, errorCode);
      return { status: "failed", errorCode };
    }

    try {
      await dependencies.recordResult(scope, context.notificationId, {
        status: "sent",
        messageId: result.messageId,
      });
      return { status: "sent" };
    } catch {
      unconfirmedDeliveries.set(reconciliationKey, result.messageId);
      logDeliveryFailure(scope, context, "delivery_unconfirmed");
      return {
        status: "unavailable",
        errorCode: "delivery_unconfirmed",
      };
    }
  }

  return function dispatch(
    scope: TaskNotificationScope,
  ): Promise<TaskNotificationResult> {
    const inFlightKey = [
      scope.tenantId,
      scope.organizationId,
      scope.taskId,
    ].join(":");
    const existingOperation = inFlightOperations.get(inFlightKey);
    if (existingOperation) return existingOperation;

    const operation = performDispatch(scope).finally(() => {
      if (inFlightOperations.get(inFlightKey) === operation) {
        inFlightOperations.delete(inFlightKey);
      }
    });
    inFlightOperations.set(inFlightKey, operation);
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

function firstContextRow(data: unknown): TaskNotificationContextRow | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0];
  if (!row || typeof row !== "object") {
    throw new Error("notification_context_unavailable");
  }
  return row as TaskNotificationContextRow;
}

const defaultTaskNotificationDependencies: TaskNotificationDependencies = {
  async loadContext(scope) {
    const { data, error } = await adminClient().rpc(
      "get_task_notification_delivery_context",
      {
        p_tenant_public_id: scope.tenantId,
        p_organization_public_id: scope.organizationId,
        p_task_public_id: scope.taskId,
      },
    );
    if (error) throw new Error("notification_context_unavailable");

    const row = firstContextRow(data);
    if (!row) return null;
    return {
      notificationId: row.notification_public_id,
      taskId: row.task_public_id,
      recipientOpenId: row.recipient_open_id,
      taskTitle: row.task_title,
      projectName: row.project_name,
      reporterName: row.reporter_name,
      priority: row.priority,
      dueDate: row.due_date ?? "无截止日期",
      acceptanceCriteria: row.acceptance_criteria,
      status: row.status,
      attemptCount: row.attempt_count,
    };
  },
  sendMessage(input) {
    return sendFeishuTaskNotification(
      input,
      getFeishuTaskNotificationEnv(),
    );
  },
  async recordResult(scope, notificationId, result) {
    const { error } = await adminClient().rpc(
      "record_task_notification_delivery",
      {
        p_tenant_public_id: scope.tenantId,
        p_organization_public_id: scope.organizationId,
        p_notification_public_id: notificationId,
        p_status: result.status,
        p_feishu_message_id: result.status === "sent"
          ? result.messageId
          : null,
        p_last_error_code: result.status === "failed"
          ? result.errorCode
          : null,
      },
    );
    if (error) throw new Error("notification_record_unavailable");
  },
};

export const dispatchTaskAssignedNotification =
  createTaskNotificationDispatcher(defaultTaskNotificationDependencies);
