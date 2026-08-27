// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTaskEventNotification } from "@/features/workstation/task-event-notification";
import { sendFeishuTaskEventNotification } from "@/features/feishu/task-notification";
import { callTaskNotificationRpc } from "@/features/workstation/task-notification";

vi.mock("@/features/feishu/task-notification", () => ({
  getFeishuTaskNotificationEnv: vi.fn(() => ({ appId: "app", appSecret: "secret" })),
  sendFeishuTaskEventNotification: vi.fn(),
}));
vi.mock("@/features/workstation/task-notification", () => ({
  callTaskNotificationRpc: vi.fn(),
}));

const scope = {
  tenantId: "8b000000-0000-4000-8000-000000000001",
  organizationId: "8b000000-0000-4000-8000-000000000002",
  notificationId: "8b000000-0000-4000-8000-000000000003",
};
const claim = {
  outcome: "success",
  action: "send",
  notificationId: scope.notificationId,
  attemptToken: "8b000000-0000-4000-8000-000000000004",
  providerRequestId: "8b000000-0000-4000-8000-000000000005",
  leaseToken: "8b000000-0000-4000-8000-000000000006",
  leaseGeneration: 1,
  isFresh: true,
  attemptCount: 1,
  recipientOpenId: "ou_recipient",
  eventType: "task.submitted",
  taskId: "8b000000-0000-4000-8000-000000000007",
  taskTitle: "提交验收",
  projectName: "商业项目",
  actorName: "执行人",
  reviewNote: "",
};

describe("durable task event notification dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the authoritative database state for an already-sent event", async () => {
    vi.mocked(callTaskNotificationRpc)
      .mockResolvedValueOnce({ outcome: "success", action: "sent", notificationId: scope.notificationId })
      .mockResolvedValueOnce({ outcome: "success", notificationId: scope.notificationId, status: "sent", version: 5 });
    await expect(dispatchTaskEventNotification(scope)).resolves.toEqual({ status: "sent", version: 5 });
    expect(sendFeishuTaskEventNotification).not.toHaveBeenCalled();
  });

  it("persists provider acceptance and completion before returning canonical state", async () => {
    vi.mocked(callTaskNotificationRpc)
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce({ outcome: "success", state: "provider_accepted" })
      .mockResolvedValueOnce({ outcome: "success", state: "sent" })
      .mockResolvedValueOnce({ outcome: "success", notificationId: scope.notificationId, status: "sent", version: 4 });
    vi.mocked(sendFeishuTaskEventNotification).mockResolvedValue({ messageId: "om_event" });

    await expect(dispatchTaskEventNotification(scope)).resolves.toEqual({ status: "sent", version: 4 });
    expect(sendFeishuTaskEventNotification).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: claim.taskId, eventType: "task.submitted" }),
      expect.anything(),
      { idempotencyKey: claim.providerRequestId },
    );
    expect(vi.mocked(callTaskNotificationRpc).mock.calls.map(([name]) => name)).toEqual([
      "claim_task_notification_event_delivery_v3",
      "record_task_notification_provider_acceptance_v2",
      "complete_task_notification_delivery_v2",
      "task_notification_delivery_state_v1",
    ]);
  });

  it("rejects a claim for a different notification before sending", async () => {
    vi.mocked(callTaskNotificationRpc).mockResolvedValueOnce({
      ...claim,
      notificationId: "8b000000-0000-4000-8000-000000000099",
    });

    await expect(dispatchTaskEventNotification(scope)).rejects.toThrow("notification_queue_unavailable");
    expect(sendFeishuTaskEventNotification).not.toHaveBeenCalled();
    expect(callTaskNotificationRpc).toHaveBeenCalledTimes(1);
  });

  it("records a confirmed provider failure and exposes the resulting version", async () => {
    vi.mocked(callTaskNotificationRpc)
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce({ outcome: "success", state: "failed" })
      .mockResolvedValueOnce({ outcome: "success", notificationId: scope.notificationId, status: "failed", version: 3 });
    vi.mocked(sendFeishuTaskEventNotification).mockRejectedValue(new Error("provider raw error"));

    await expect(dispatchTaskEventNotification(scope)).resolves.toEqual({ status: "failed", version: 3 });
    expect(vi.mocked(callTaskNotificationRpc).mock.calls[1]).toEqual([
      "fail_task_notification_delivery_v2",
      expect.objectContaining({ p_error_code: "send_failed" }),
    ]);
  });

  it("preserves a stable token failure code without exposing provider details", async () => {
    vi.mocked(callTaskNotificationRpc)
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce({ outcome: "success", state: "failed" })
      .mockResolvedValueOnce({ outcome: "success", notificationId: scope.notificationId, status: "failed", version: 3 });
    vi.mocked(sendFeishuTaskEventNotification).mockRejectedValue(new Error("token_unavailable"));
    await dispatchTaskEventNotification(scope);
    expect(vi.mocked(callTaskNotificationRpc).mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ p_error_code: "token_unavailable" }),
    );
  });
});
