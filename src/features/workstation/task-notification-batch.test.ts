import { describe, expect, it, vi } from "vitest";

import {
  createTaskNotificationBatchDispatcher,
  type TaskNotificationBatchScope,
} from "@/features/workstation/task-notification-batch";
import type { TaskNotificationDeliveryClaim } from "@/features/workstation/task-notification";

const baseScope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
};

function scope(taskId: string): TaskNotificationBatchScope {
  return { ...baseScope, taskId };
}

function token(suffix: string) {
  return `40000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

function claim(taskId: string, recipientOpenId: string | null, index: number, overrides = {}) {
  return {
    action: "send",
    notificationId: token(String(100 + index)),
    attemptToken: token(String(200 + index)),
    providerRequestId: token(String(200 + index)),
    leaseToken: token(String(300 + index)),
    leaseGeneration: 1,
    isFresh: true,
    attemptCount: 1,
    taskId,
    recipientOpenId,
    taskTitle: `任务-${taskId}`,
    projectName: "企业工作站",
    reporterName: "负责人",
    priority: "high",
    dueDate: "2026-08-25",
    acceptanceCriteria: "负责人验收通过",
    ...overrides,
  } satisfies Extract<TaskNotificationDeliveryClaim, { action: "send" }>;
}

type Dependencies = Parameters<typeof createTaskNotificationBatchDispatcher>[0];

function dependencies(
  claims: Map<string, TaskNotificationDeliveryClaim | null>,
  overrides: Partial<Dependencies> = {},
) {
  return {
    createAttemptToken: vi.fn(() => token("999")),
    claim: vi.fn(async ({ taskId }: TaskNotificationBatchScope) => claims.get(taskId) ?? null),
    sendBatch: vi.fn().mockResolvedValue({ messageId: "om_batch" }),
    recordProviderAcceptance: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue({ state: "failed" }),
    ...overrides,
  } satisfies Dependencies;
}

describe("durable batch task assignment delivery", () => {
  it("sends one independently recoverable provider message per notification", async () => {
    const first = claim(token("1"), "ou_employee", 1);
    const second = claim(token("2"), "ou_employee", 2);
    const deps = dependencies(new Map([
      [token("1"), first],
      [token("2"), second],
    ]));

    await expect(createTaskNotificationBatchDispatcher(deps)([
      scope(token("1")), scope(token("2")),
    ])).resolves.toEqual({
      [token("1")]: { status: "sent" },
      [token("2")]: { status: "sent" },
    });

    expect(deps.sendBatch).toHaveBeenCalledTimes(2);
    expect(deps.sendBatch).toHaveBeenCalledWith(expect.objectContaining({
      recipientOpenId: "ou_employee",
      tasks: [expect.objectContaining({ taskId: token("1") })],
    }), first.providerRequestId);
    expect(deps.sendBatch).toHaveBeenCalledWith(expect.objectContaining({
      recipientOpenId: "ou_employee",
      tasks: [expect.objectContaining({ taskId: token("2") })],
    }), second.providerRequestId);
    expect(deps.recordProviderAcceptance).toHaveBeenCalledTimes(2);
    expect(deps.complete).toHaveBeenCalledTimes(2);
  });

  it("deduplicates repeated task IDs without inventing a cross-task batch identity", async () => {
    const taskId = token("1");
    const deps = dependencies(new Map([[taskId, claim(taskId, "ou_employee", 1)]]));

    await createTaskNotificationBatchDispatcher(deps)([scope(taskId), scope(taskId)]);

    expect(deps.claim).toHaveBeenCalledTimes(1);
    expect(deps.sendBatch).toHaveBeenCalledTimes(1);
  });

  it("keeps different recipients in separate provider messages", async () => {
    const deps = dependencies(new Map([
      [token("1"), claim(token("1"), "ou_a", 1)],
      [token("2"), claim(token("2"), "ou_b", 2)],
    ]));

    await createTaskNotificationBatchDispatcher(deps)([scope(token("1")), scope(token("2"))]);

    expect(deps.sendBatch).toHaveBeenCalledTimes(2);
  });

  it("reuses each notification's stable provider UUID after restart", async () => {
    const providerRequestId = token("777");
    const taskId = token("1");
    const deps = dependencies(new Map([[
      taskId,
      claim(taskId, "ou_employee", 1, {
        isFresh: false,
        providerRequestId,
        leaseToken: token("778"),
        leaseGeneration: 2,
      }),
    ]]));

    await createTaskNotificationBatchDispatcher(deps)([scope(taskId)]);

    expect(deps.sendBatch).toHaveBeenCalledWith(expect.any(Object), providerRequestId);
  });

  it("finalizes a durable accepted claim without sending again", async () => {
    const taskId = token("1");
    const claims = new Map<string, TaskNotificationDeliveryClaim | null>([[taskId, {
      action: "finalize",
      notificationId: token("101"),
      attemptToken: token("201"),
      providerRequestId: token("201"),
      leaseToken: token("301"),
      leaseGeneration: 2,
      messageId: "om_existing",
    }]]);
    const deps = dependencies(claims);

    await expect(createTaskNotificationBatchDispatcher(deps)([scope(taskId)]))
      .resolves.toEqual({ [taskId]: { status: "sent" } });
    expect(deps.sendBatch).not.toHaveBeenCalled();
    expect(deps.complete).toHaveBeenCalledWith(
      scope(taskId), token("101"), token("201"), token("301"), 2,
    );
  });

  it("marks only a missing-recipient item unavailable", async () => {
    const deps = dependencies(new Map([
      [token("1"), claim(token("1"), null, 1)],
      [token("2"), claim(token("2"), "ou_employee", 2)],
    ]));

    await expect(createTaskNotificationBatchDispatcher(deps)([
      scope(token("1")), scope(token("2")),
    ])).resolves.toEqual({
      [token("1")]: { status: "unavailable", errorCode: "recipient_unavailable" },
      [token("2")]: { status: "sent" },
    });
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: token("1") }),
      expect.any(Object),
      "recipient_unavailable",
    );
    expect(deps.sendBatch).toHaveBeenCalledTimes(1);
  });

  it("leaves a lost provider response claimed for an idempotent retry", async () => {
    const taskId = token("1");
    const deps = dependencies(
      new Map([[taskId, claim(taskId, "ou_employee", 1)]]),
      { sendBatch: vi.fn().mockRejectedValue(new Error("delivery_unconfirmed")) },
    );

    await expect(createTaskNotificationBatchDispatcher(deps)([scope(taskId)]))
      .resolves.toEqual({
        [taskId]: { status: "unavailable", errorCode: "delivery_unconfirmed" },
      });
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it("isolates an acceptance persistence failure to its notification", async () => {
    const deps = dependencies(
      new Map([
        [token("1"), claim(token("1"), "ou_employee", 1)],
        [token("2"), claim(token("2"), "ou_employee", 2)],
      ]),
      {
        recordProviderAcceptance: vi.fn()
          .mockRejectedValueOnce(new Error("db unavailable"))
          .mockResolvedValueOnce(undefined),
      },
    );

    const result = await createTaskNotificationBatchDispatcher(deps)([
      scope(token("1")), scope(token("2")),
    ]);

    expect(Object.values(result)).toContainEqual({
      status: "unavailable", errorCode: "delivery_unconfirmed",
    });
    expect(Object.values(result)).toContainEqual({ status: "sent" });
    expect(deps.sendBatch).toHaveBeenCalledTimes(2);
    expect(deps.fail).not.toHaveBeenCalled();
  });
});
