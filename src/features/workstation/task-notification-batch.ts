import { createClient } from "@supabase/supabase-js";

import {
  getFeishuTaskNotificationEnv,
  sendFeishuTaskBatchNotification,
  type FeishuTaskBatchNotificationInput,
} from "@/features/feishu/task-notification";
import { getSupabaseEnv } from "@/lib/supabase/env";

export type TaskNotificationBatchScope = {
  tenantId: string;
  organizationId: string;
  taskId: string;
};

export type TaskNotificationBatchContext = {
  notificationId: string;
  taskId: string;
  recipientOpenId: string | null;
  taskTitle: string;
  projectName: string;
  reporterName: string;
  priority: string;
  dueDate: string;
  acceptanceCriteria: string;
  status: "pending" | "sent" | "failed";
  attemptCount: number;
};

type TaskNotificationBatchErrorCode =
  | "token_unavailable"
  | "recipient_unavailable"
  | "send_failed"
  | "configuration_unavailable"
  | "queue_unavailable"
  | "delivery_unconfirmed";

export type TaskNotificationBatchResult =
  | { status: "sent" }
  | {
      status: "failed" | "unavailable";
      errorCode: TaskNotificationBatchErrorCode;
    };

type DeliveryRecord =
  | { status: "sent"; messageId: string }
  | {
      status: "failed";
      errorCode: TaskNotificationBatchErrorCode;
    };

type TaskNotificationBatchDependencies = {
  loadContext: (
    scope: TaskNotificationBatchScope,
  ) => Promise<TaskNotificationBatchContext | null>;
  sendBatch: (
    input: FeishuTaskBatchNotificationInput,
  ) => Promise<{ messageId: string }>;
  recordResult: (
    scope: TaskNotificationBatchScope,
    notificationId: string,
    result: DeliveryRecord,
  ) => Promise<void>;
};

type ContextRow = {
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

function stableSendError(error: unknown): TaskNotificationBatchErrorCode {
  const code = error instanceof Error ? error.message : "";
  return code === "token_unavailable" || code === "configuration_unavailable"
    ? code
    : "send_failed";
}

function taskPayload(context: TaskNotificationBatchContext) {
  return {
    taskId: context.taskId,
    taskTitle: context.taskTitle,
    projectName: context.projectName,
    priority: context.priority,
    dueDate: context.dueDate,
    acceptanceCriteria: context.acceptanceCriteria,
  };
}

export function createTaskNotificationBatchDispatcher(
  dependencies: TaskNotificationBatchDependencies,
) {
  return async function dispatchBatch(scopes: TaskNotificationBatchScope[]) {
    const results: Record<string, TaskNotificationBatchResult> = {};
    const pending: Array<{
      scope: TaskNotificationBatchScope;
      context: TaskNotificationBatchContext;
    }> = [];

    await Promise.all(scopes.map(async (scope) => {
      let context: TaskNotificationBatchContext | null;
      try {
        context = await dependencies.loadContext(scope);
      } catch {
        results[scope.taskId] = {
          status: "unavailable",
          errorCode: "queue_unavailable",
        };
        return;
      }
      if (!context) {
        results[scope.taskId] = {
          status: "unavailable",
          errorCode: "recipient_unavailable",
        };
        return;
      }
      if (context.status === "sent") {
        results[scope.taskId] = { status: "sent" };
        return;
      }
      const recipientOpenId = context.recipientOpenId?.trim();
      if (!recipientOpenId) {
        try {
          await dependencies.recordResult(scope, context.notificationId, {
            status: "failed",
            errorCode: "recipient_unavailable",
          });
          results[scope.taskId] = {
            status: "unavailable",
            errorCode: "recipient_unavailable",
          };
        } catch {
          results[scope.taskId] = {
            status: "unavailable",
            errorCode: "queue_unavailable",
          };
        }
        return;
      }
      pending.push({
        scope,
        context: { ...context, recipientOpenId },
      });
    }));

    const groups = new Map<string, typeof pending>();
    pending.forEach((item) => {
      const key = item.context.recipientOpenId as string;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    });

    await Promise.all([...groups.entries()].map(async ([recipientOpenId, group]) => {
      let messageId: string;
      try {
        const delivery = await dependencies.sendBatch({
          recipientOpenId,
          reporterName: group[0].context.reporterName,
          tasks: group.map(({ context }) => taskPayload(context)),
        });
        messageId = delivery.messageId;
      } catch (error) {
        const errorCode = stableSendError(error);
        await Promise.all(group.map(async ({ scope, context }) => {
          try {
            await dependencies.recordResult(scope, context.notificationId, {
              status: "failed",
              errorCode,
            });
            results[scope.taskId] = { status: "failed", errorCode };
          } catch {
            results[scope.taskId] = {
              status: "unavailable",
              errorCode: "queue_unavailable",
            };
          }
        }));
        return;
      }

      await Promise.all(group.map(async ({ scope, context }) => {
        try {
          await dependencies.recordResult(scope, context.notificationId, {
            status: "sent",
            messageId,
          });
          results[scope.taskId] = { status: "sent" };
        } catch {
          results[scope.taskId] = {
            status: "unavailable",
            errorCode: "delivery_unconfirmed",
          };
        }
      }));
    }));

    return results;
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

const defaultDependencies: TaskNotificationBatchDependencies = {
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
    const row = Array.isArray(data) ? data[0] as ContextRow | undefined : undefined;
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
  sendBatch(input) {
    return sendFeishuTaskBatchNotification(
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
        p_feishu_message_id: result.status === "sent" ? result.messageId : null,
        p_last_error_code: result.status === "failed" ? result.errorCode : null,
      },
    );
    if (error) throw new Error("notification_record_unavailable");
  },
};

export const dispatchTaskAssignmentBatch =
  createTaskNotificationBatchDispatcher(defaultDependencies);
