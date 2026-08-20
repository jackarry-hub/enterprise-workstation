import { describe, expect, it, vi } from "vitest";

import { createWorkstationTaskNotifyHandler } from "@/app/api/workstation/tasks/[taskId]/notify/handler";
import * as notifyRoute from "@/app/api/workstation/tasks/[taskId]/notify/route";

const taskId = "44444444-4444-4444-8444-444444444444";

const managerSession = {
  tenantId: "22222222-2222-4222-8222-222222222222",
  organization: { id: "33333333-3333-4333-8333-333333333333" },
  member: { id: 7 },
  permissionCodes: ["task.manage"],
};

function notifyRequest() {
  return new Request(
    "https://workspace.test/api/workstation/tasks/44444444-4444-4444-8444-444444444444/notify?tenantId=spoofed&organizationId=spoofed",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantId: "spoofed",
        organizationId: "spoofed",
        taskId: "55555555-5555-4555-8555-555555555555",
      }),
    },
  );
}

function routeContext(value = taskId) {
  return { params: Promise.resolve({ taskId: value }) };
}

describe("workstation task notification retry", () => {
  it("returns 401 without a workspace session", async () => {
    const notifyTask = vi.fn();
    const handler = createWorkstationTaskNotifyHandler({
      loadSession: async () => null,
      notifyTask,
    });

    const response = await handler(notifyRequest(), routeContext());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(notifyTask).not.toHaveBeenCalled();
  });

  it("returns 403 without task management permission", async () => {
    const notifyTask = vi.fn();
    const handler = createWorkstationTaskNotifyHandler({
      loadSession: async () => ({
        ...managerSession,
        permissionCodes: ["task.execute"],
      }),
      notifyTask,
    });

    const response = await handler(notifyRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(notifyTask).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID task ID", async () => {
    const notifyTask = vi.fn();
    const handler = createWorkstationTaskNotifyHandler({
      loadSession: async () => managerSession,
      notifyTask,
    });

    const response = await handler(notifyRequest(), routeContext("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_task" });
    expect(notifyTask).not.toHaveBeenCalled();
  });

  it("retries the route task in the authenticated tenant and organization scope", async () => {
    const notifyTask = vi.fn().mockResolvedValue({ status: "sent" as const });
    const handler = createWorkstationTaskNotifyHandler({
      loadSession: async () => managerSession,
      notifyTask,
    });

    const response = await handler(notifyRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(notifyTask).toHaveBeenCalledWith({
      tenantId: managerSession.tenantId,
      organizationId: managerSession.organization.id,
      taskId,
    });
    expect(await response.json()).toEqual({ notification: { status: "sent" } });
  });

  it.each([
    { status: "failed", errorCode: "send_failed" },
    { status: "unavailable", errorCode: "recipient_unavailable" },
    { status: "unavailable", errorCode: "delivery_unconfirmed" },
    { status: "unavailable", errorCode: "queue_unavailable" },
  ] as const)(
    "returns HTTP 200 for a safe $status/$errorCode dispatcher result",
    async (notification) => {
      const handler = createWorkstationTaskNotifyHandler({
        loadSession: async () => managerSession,
        notifyTask: vi.fn().mockResolvedValue(notification),
      });

      const response = await handler(notifyRequest(), routeContext());

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ notification });
    },
  );

  it("normalizes rejected retries without exposing provider details", async () => {
    const sensitiveMessage = "Feishu rejected open_id ou_secret with token abc123";
    const handler = createWorkstationTaskNotifyHandler({
      loadSession: async () => managerSession,
      notifyTask: vi.fn().mockRejectedValue(new Error(sensitiveMessage)),
    });

    const response = await handler(notifyRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ error: "notification_retry_failed" });
    expect(JSON.stringify(body)).not.toContain(sensitiveMessage);
  });

  it("normalizes synchronous retry failures", async () => {
    const handler = createWorkstationTaskNotifyHandler({
      loadSession: async () => managerSession,
      notifyTask: vi.fn().mockImplementation(() => {
        throw new Error("sensitive synchronous provider failure");
      }),
    });

    const response = await handler(notifyRequest(), routeContext());

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "notification_retry_failed",
    });
  });

  it("binds only POST as an HTTP method", () => {
    expect(typeof notifyRoute.POST).toBe("function");
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(notifyRoute).not.toHaveProperty(method);
    }
  });
});
