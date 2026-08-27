// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createTaskNotificationRecoveryHandler } from "@/app/api/internal/task-notification-recovery/handler";

const secret = "n".repeat(32);

describe("scheduled task notification recovery", () => {
  it("fails closed without a configured scheduler secret", async () => {
    const recover = vi.fn();
    const response = await createTaskNotificationRecoveryHandler({ cronSecret: null, recover })(
      new Request("https://workspace.test/api/internal/task-notification-recovery", { method: "POST" }),
    );
    expect(response.status).toBe(503);
    expect(recover).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token", async () => {
    const recover = vi.fn();
    const response = await createTaskNotificationRecoveryHandler({ cronSecret: secret, recover })(
      new Request("https://workspace.test/api/internal/task-notification-recovery", {
        method: "POST", headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(response.status).toBe(401);
    expect(recover).not.toHaveBeenCalled();
  });

  it("returns only aggregate recovery evidence", async () => {
    const recover = vi.fn().mockResolvedValue({ claimed: 4, sent: 2, pending: 1, failed: 1, unavailable: 0 });
    const response = await createTaskNotificationRecoveryHandler({ cronSecret: secret, recover })(
      new Request("https://workspace.test/api/internal/task-notification-recovery?tenant=forged", {
        method: "POST", headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed: 4, sent: 2, pending: 1, failed: 1, unavailable: 0 });
    expect(recover).toHaveBeenCalledWith();
  });
});
