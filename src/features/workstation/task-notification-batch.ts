import {
  getFeishuTaskNotificationEnv,
  sendFeishuTaskBatchNotification,
  type FeishuTaskBatchNotificationInput,
} from "@/features/feishu/task-notification";
import {
  defaultTaskNotificationDependencies,
  type TaskNotificationDeliveryClaim,
  type TaskNotificationDependencies,
  type TaskNotificationErrorCode,
  type TaskNotificationScope,
} from "@/features/workstation/task-notification";

export type TaskNotificationBatchScope = TaskNotificationScope;
export type TaskNotificationBatchContext = Extract<TaskNotificationDeliveryClaim, { action: "send" }>;

export type TaskNotificationBatchResult =
  | { status: "sent" }
  | { status: "failed" | "unavailable"; errorCode: TaskNotificationErrorCode };

type SendClaim = Extract<TaskNotificationDeliveryClaim, { action: "send" }>;
type TaskNotificationBatchDependencies = Pick<
  TaskNotificationDependencies,
  "createAttemptToken" | "claim" | "recordProviderAcceptance" | "complete" | "fail"
> & {
  sendBatch: (
    input: FeishuTaskBatchNotificationInput,
    providerRequestId: string,
  ) => Promise<{ messageId: string }>;
};

function stableSendError(error: unknown): TaskNotificationErrorCode {
  const code = error instanceof Error ? error.message : "";
  return code === "token_unavailable" || code === "configuration_unavailable"
      || code === "delivery_unconfirmed"
    ? code
    : "send_failed";
}

function taskPayload(context: SendClaim) {
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
  return async function dispatchBatch(inputScopes: TaskNotificationBatchScope[]) {
    const scopes = [...new Map(inputScopes.map((scope) => [scope.taskId, scope])).values()];
    const entries = await Promise.all(scopes.map(async (scope) => {
      let claim: TaskNotificationDeliveryClaim | null;
      try {
        claim = await dependencies.claim(scope, dependencies.createAttemptToken());
      } catch (error) {
        return [scope.taskId, {
          status: "unavailable",
          errorCode: error instanceof Error && error.message === "configuration_unavailable"
            ? "configuration_unavailable"
            : "queue_unavailable",
        }] as const;
      }
      if (!claim) {
        return [scope.taskId, { status: "unavailable", errorCode: "recipient_unavailable" }] as const;
      }
      if (claim.action === "sent") return [scope.taskId, { status: "sent" }] as const;
      if (claim.action === "in_progress") {
        return [scope.taskId, { status: "unavailable", errorCode: "delivery_unconfirmed" }] as const;
      }
      if (claim.action === "finalize") {
        try {
          await dependencies.complete(
            scope, claim.notificationId, claim.attemptToken,
            claim.leaseToken, claim.leaseGeneration,
          );
          return [scope.taskId, { status: "sent" }] as const;
        } catch {
          return [scope.taskId, { status: "unavailable", errorCode: "delivery_unconfirmed" }] as const;
        }
      }

      const recipientOpenId = claim.recipientOpenId?.trim();
      if (!recipientOpenId) {
        try {
          await dependencies.fail(scope, claim, "recipient_unavailable");
          return [scope.taskId, { status: "unavailable", errorCode: "recipient_unavailable" }] as const;
        } catch {
          return [scope.taskId, { status: "unavailable", errorCode: "queue_unavailable" }] as const;
        }
      }

      let messageId: string;
      try {
        ({ messageId } = await dependencies.sendBatch({
          recipientOpenId,
          reporterName: claim.reporterName,
          // Commercial recovery is per notification. Cross-task aggregation
          // requires a durable batch entity and is intentionally not inferred
          // from the caller's transient scope list.
          tasks: [taskPayload(claim)],
        }, claim.providerRequestId));
      } catch (error) {
        const errorCode = stableSendError(error);
        if (errorCode === "delivery_unconfirmed") {
          return [scope.taskId, { status: "unavailable", errorCode }] as const;
        }
        try {
          const failure = await dependencies.fail(scope, claim, errorCode);
          if (failure.state === "sent") return [scope.taskId, { status: "sent" }] as const;
          if (failure.state === "provider_accepted") {
            await dependencies.complete(
              scope, claim.notificationId, claim.attemptToken,
              claim.leaseToken, claim.leaseGeneration,
            );
            return [scope.taskId, { status: "sent" }] as const;
          }
          return [scope.taskId, { status: "failed", errorCode }] as const;
        } catch {
          return [scope.taskId, { status: "unavailable", errorCode: "queue_unavailable" }] as const;
        }
      }

      try {
        await dependencies.recordProviderAcceptance(scope, claim, messageId);
      } catch {
        return [scope.taskId, { status: "unavailable", errorCode: "delivery_unconfirmed" }] as const;
      }
      try {
        await dependencies.complete(
          scope, claim.notificationId, claim.attemptToken,
          claim.leaseToken, claim.leaseGeneration,
        );
        return [scope.taskId, { status: "sent" }] as const;
      } catch {
        return [scope.taskId, { status: "unavailable", errorCode: "delivery_unconfirmed" }] as const;
      }
    }));
    return Object.fromEntries(entries) as Record<string, TaskNotificationBatchResult>;
  };
}

const defaultDependencies: TaskNotificationBatchDependencies = {
  ...defaultTaskNotificationDependencies,
  sendBatch(input, providerRequestId) {
    return sendFeishuTaskBatchNotification(input, getFeishuTaskNotificationEnv(), {
      idempotencyKey: providerRequestId,
    });
  },
};

export const dispatchTaskAssignmentBatch = createTaskNotificationBatchDispatcher(defaultDependencies);
