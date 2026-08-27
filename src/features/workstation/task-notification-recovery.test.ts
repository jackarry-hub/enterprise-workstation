// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDefaultTaskNotificationRecovery } from "@/features/workstation/task-notification-recovery";
import { dispatchTaskEventNotification } from "@/features/workstation/task-event-notification";
import { callTaskNotificationRowsRpc } from "@/features/workstation/task-notification";

vi.mock("@/features/workstation/task-event-notification", () => ({
  dispatchTaskEventNotification: vi.fn(),
}));
vi.mock("@/features/workstation/task-notification", () => ({
  callTaskNotificationRowsRpc: vi.fn(),
}));

const rows = [0, 1, 2, 3].map((index) => ({
  tenant_public_id: `8c000000-0000-4000-8000-00000000000${index + 1}`,
  organization_public_id: `8d000000-0000-4000-8000-00000000000${index + 1}`,
  notification_public_id: `8e000000-0000-4000-8000-00000000000${index + 1}`,
}));

describe("scheduled task notification recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enumerates only a bounded service queue and aggregates canonical outcomes", async () => {
    vi.mocked(callTaskNotificationRowsRpc).mockResolvedValue(rows);
    vi.mocked(dispatchTaskEventNotification)
      .mockResolvedValueOnce({ status: "sent", version: 3 })
      .mockResolvedValueOnce({ status: "sending", version: 2 })
      .mockResolvedValueOnce({ status: "failed", version: 4 })
      .mockRejectedValueOnce(new Error("isolated row failure"));
    await expect(runDefaultTaskNotificationRecovery(25)).resolves.toEqual({
      claimed: 4, sent: 1, pending: 1, failed: 1, unavailable: 1,
    });
    expect(callTaskNotificationRowsRpc).toHaveBeenCalledWith(
      "due_task_notifications_for_delivery", { p_limit: 25 },
    );
    expect(dispatchTaskEventNotification).toHaveBeenCalledTimes(4);
  });

  it("fails closed for invalid limits or malformed service rows", async () => {
    await expect(runDefaultTaskNotificationRecovery(0)).rejects.toThrow("notification_recovery_invalid_limit");
    vi.mocked(callTaskNotificationRowsRpc).mockResolvedValue([{ ...rows[0], notification_public_id: "unsafe" }]);
    await expect(runDefaultTaskNotificationRecovery()).rejects.toThrow("notification_queue_unavailable");
    expect(dispatchTaskEventNotification).not.toHaveBeenCalled();
  });
});
