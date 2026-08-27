// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createTaskNotificationRetryHandler } from "@/features/workstation/task-notification-retry-handler";

const taskId = "89000000-0000-4000-8000-000000000001";
const key = "89000000-0000-4000-8000-000000000002";
const requestId = "89000000-0000-4000-8000-000000000003";
const session = {
  tenantId: "89000000-0000-4000-8000-000000000004",
  organization: { id: "89000000-0000-4000-8000-000000000005" },
  member: { status: "active" },
  permissionCodes: [] as readonly string[],
};
const context = { params: Promise.resolve({ taskId }) };

function request(body: unknown = { reason: "人工确认身份修复后重试" }, idempotencyKey = key) {
  return new Request(`https://workspace.test/api/workstation/tasks/${taskId}/notifications/retry`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    loadSession: async () => session,
    authorizeRetry: vi.fn().mockResolvedValue({
      outcome: "success",
      resource: "task_notification",
      entity: { taskId },
    }),
    notifyTask: vi.fn().mockResolvedValue({ status: "sent" }),
    createRequestId: () => requestId,
    ...overrides,
  } as never;
}

describe("task-assignment notification retry route", () => {
  it("lets the database project ACL authorize a project manager without a global permission", async () => {
    const authorizeRetry = vi.fn().mockResolvedValue({
      outcome: "success", resource: "task_notification", entity: { taskId },
    });
    const notifyTask = vi.fn().mockResolvedValue({ status: "sent" });
    const response = await createTaskNotificationRetryHandler(dependencies({ authorizeRetry, notifyTask }))(
      request(), context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authorizeRetry).toHaveBeenCalledWith(taskId, "人工确认身份修复后重试", requestId, key);
    expect(notifyTask).toHaveBeenCalledWith({
      tenantId: session.tenantId,
      organizationId: session.organization.id,
      taskId,
    });
    expect(await response.json()).toEqual({ notification: { status: "sent" } });
  });

  it("fails closed for an inactive session or malformed command before authorization", async () => {
    const authorizeRetry = vi.fn();
    const inactive = await createTaskNotificationRetryHandler(dependencies({
      loadSession: async () => ({ ...session, member: { status: "suspended" } }),
      authorizeRetry,
    }))(request(), context);
    expect(inactive.status).toBe(403);

    const malformed = await createTaskNotificationRetryHandler(dependencies({ authorizeRetry }))(
      request({ reason: "", extra: true }), context,
    );
    expect(malformed.status).toBe(400);
    expect(authorizeRetry).not.toHaveBeenCalled();
  });

  it("returns safe DB authorization failures and preserves durable retry after dispatch errors", async () => {
    const denied = await createTaskNotificationRetryHandler(dependencies({
      authorizeRetry: vi.fn().mockResolvedValue({ outcome: "failure", error: "forbidden" }),
    }))(request(), context);
    expect(denied.status).toBe(403);

    const unavailable = await createTaskNotificationRetryHandler(dependencies({
      notifyTask: vi.fn().mockRejectedValue(new Error("raw provider detail")),
    }))(request(), context);
    expect(unavailable.status).toBe(200);
    expect(await unavailable.json()).toEqual({
      notification: { status: "unavailable", errorCode: "queue_unavailable" },
    });
  });
});
