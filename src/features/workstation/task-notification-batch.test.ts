import { describe, expect, it, vi } from "vitest";

import {
  createTaskNotificationBatchDispatcher,
  type TaskNotificationBatchContext,
  type TaskNotificationBatchScope,
} from "@/features/workstation/task-notification-batch";

const baseScope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
};

function scope(taskId: string): TaskNotificationBatchScope {
  return { ...baseScope, taskId };
}

function context(
  taskId: string,
  recipientOpenId: string | null,
): TaskNotificationBatchContext {
  return {
    notificationId: `notification-${taskId}`,
    taskId,
    recipientOpenId,
    taskTitle: `任务-${taskId}`,
    projectName: "企业工作站",
    reporterName: "负责人",
    priority: "P1",
    dueDate: "2026-08-25",
    acceptanceCriteria: "负责人验收通过",
    status: "pending",
    attemptCount: 0,
  };
}

describe("batch task assignment notification", () => {
  it("groups multiple tasks for one employee into one Feishu message and records every task", async () => {
    const contexts = new Map([
      ["task-a", context("task-a", "ou_employee")],
      ["task-b", context("task-b", "ou_employee")],
    ]);
    const sendBatch = vi.fn().mockResolvedValue({ messageId: "om_batch" });
    const recordResult = vi.fn().mockResolvedValue(undefined);
    const dispatch = createTaskNotificationBatchDispatcher({
      loadContext: async ({ taskId }) => contexts.get(taskId) ?? null,
      sendBatch,
      recordResult,
    });

    await expect(dispatch([scope("task-a"), scope("task-b")])).resolves.toEqual({
      "task-a": { status: "sent" },
      "task-b": { status: "sent" },
    });

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch).toHaveBeenCalledWith(expect.objectContaining({
      recipientOpenId: "ou_employee",
      reporterName: "负责人",
      tasks: expect.arrayContaining([
        expect.objectContaining({ taskId: "task-a" }),
        expect.objectContaining({ taskId: "task-b" }),
      ]),
    }));
    expect(recordResult).toHaveBeenCalledTimes(2);
    expect(recordResult).toHaveBeenCalledWith(
      scope("task-a"),
      "notification-task-a",
      { status: "sent", messageId: "om_batch" },
    );
    expect(recordResult).toHaveBeenCalledWith(
      scope("task-b"),
      "notification-task-b",
      { status: "sent", messageId: "om_batch" },
    );
  });

  it("sends separate cards to different employees", async () => {
    const contexts = new Map([
      ["task-a", context("task-a", "ou_employee_a")],
      ["task-b", context("task-b", "ou_employee_b")],
    ]);
    const sendBatch = vi.fn()
      .mockResolvedValueOnce({ messageId: "om_a" })
      .mockResolvedValueOnce({ messageId: "om_b" });
    const dispatch = createTaskNotificationBatchDispatcher({
      loadContext: async ({ taskId }) => contexts.get(taskId) ?? null,
      sendBatch,
      recordResult: vi.fn().mockResolvedValue(undefined),
    });

    const result = await dispatch([scope("task-a"), scope("task-b")]);

    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      "task-a": { status: "sent" },
      "task-b": { status: "sent" },
    });
  });

  it("marks only the employee without an open_id unavailable", async () => {
    const contexts = new Map([
      ["task-a", context("task-a", null)],
      ["task-b", context("task-b", "ou_employee")],
    ]);
    const sendBatch = vi.fn().mockResolvedValue({ messageId: "om_b" });
    const recordResult = vi.fn().mockResolvedValue(undefined);
    const dispatch = createTaskNotificationBatchDispatcher({
      loadContext: async ({ taskId }) => contexts.get(taskId) ?? null,
      sendBatch,
      recordResult,
    });

    await expect(dispatch([scope("task-a"), scope("task-b")])).resolves.toEqual({
      "task-a": { status: "unavailable", errorCode: "recipient_unavailable" },
      "task-b": { status: "sent" },
    });
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(recordResult).toHaveBeenCalledWith(
      scope("task-a"),
      "notification-task-a",
      { status: "failed", errorCode: "recipient_unavailable" },
    );
  });
});
