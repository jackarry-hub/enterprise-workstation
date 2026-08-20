import { describe, expect, it, vi } from "vitest";

import { createWorkstationTaskCreateHandler } from "@/app/api/workstation/tasks/handler";

const tenantId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const taskId = "44444444-4444-4444-8444-444444444444";

const managerSession = {
  tenantId,
  organization: { id: organizationId },
  member: { id: 7 },
  permissionCodes: ["task.manage"],
};

const validBody = {
  projectId: "11111111-1111-4111-8111-111111111111",
  assigneeMemberId: "m8",
  title: "完成飞书协作联调",
  description: "验证员工领取、提交和负责人验收",
  acceptanceCriteria: "负责人验收通过",
  dueDate: "2026-08-25",
  priority: "P1",
};

const task = { id: taskId, st: "待处理" };

function taskCreateRequest(body: unknown = validBody) {
  return new Request("https://workspace.test/api/workstation/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("formal workstation task creation", () => {
  it("requires task management permission", async () => {
    const createTask = vi.fn();
    const notifyTask = vi.fn();
    const handler = createWorkstationTaskCreateHandler({
      loadSession: async () => ({
        ...managerSession,
        permissionCodes: ["task.execute"],
      }),
      createTask,
      notifyTask,
    });

    const response = await handler(taskCreateRequest());

    expect(response.status).toBe(403);
    expect(createTask).not.toHaveBeenCalled();
    expect(notifyTask).not.toHaveBeenCalled();
  });

  it("creates the task before notifying its assignee with the returned public task ID", async () => {
    const callOrder: string[] = [];
    const createTask = vi.fn().mockImplementation(async () => {
      callOrder.push("created");
      return task;
    });
    const notifyTask = vi.fn().mockImplementation(async () => {
      callOrder.push("notified");
      return { status: "sent" as const };
    });
    const handler = createWorkstationTaskCreateHandler({
      loadSession: async () => managerSession,
      createTask,
      notifyTask,
    });

    const response = await handler(taskCreateRequest({
      ...validBody,
      reporterMemberId: 999,
    }));

    expect(response.status).toBe(201);
    expect(createTask).toHaveBeenCalledWith({
      actorMemberId: 7,
      projectId: validBody.projectId,
      assigneeMemberId: 8,
      title: validBody.title,
      description: validBody.description,
      acceptanceCriteria: validBody.acceptanceCriteria,
      dueDate: validBody.dueDate,
      priority: "high",
    });
    expect(notifyTask).toHaveBeenCalledWith({
      tenantId,
      organizationId,
      taskId,
    });
    expect(callOrder).toEqual(["created", "notified"]);
    await expect(response.json()).resolves.toEqual({
      task,
      notification: { status: "sent" },
    });
  });

  it("rejects malformed task input", async () => {
    const createTask = vi.fn();
    const notifyTask = vi.fn();
    const handler = createWorkstationTaskCreateHandler({
      loadSession: async () => managerSession,
      createTask,
      notifyTask,
    });

    const response = await handler(taskCreateRequest({
      ...validBody,
      assigneeMemberId: "m0",
    }));

    expect(response.status).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
    expect(notifyTask).not.toHaveBeenCalled();
  });

  it.each([
    { status: "failed", errorCode: "send_failed" },
    { status: "unavailable", errorCode: "recipient_unavailable" },
    { status: "unavailable", errorCode: "delivery_unconfirmed" },
    { status: "unavailable", errorCode: "queue_unavailable" },
  ] as const)(
    "keeps HTTP 201 when notification delivery returns $status/$errorCode",
    async (notification) => {
      const handler = createWorkstationTaskCreateHandler({
        loadSession: async () => managerSession,
        createTask: vi.fn().mockResolvedValue(task),
        notifyTask: vi.fn().mockResolvedValue(notification),
      });

      const response = await handler(taskCreateRequest());

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ task, notification });
    },
  );

  it("normalizes unexpected notifier exceptions without exposing their messages", async () => {
    const sensitiveMessage = "Feishu rejected secret credential abc123";
    const handler = createWorkstationTaskCreateHandler({
      loadSession: async () => managerSession,
      createTask: vi.fn().mockResolvedValue(task),
      notifyTask: vi.fn().mockRejectedValue(new Error(sensitiveMessage)),
    });

    const response = await handler(taskCreateRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      task,
      notification: { status: "failed", errorCode: "send_failed" },
    });
    expect(JSON.stringify(body)).not.toContain(sensitiveMessage);
  });

  it("does not notify when task creation fails", async () => {
    const notifyTask = vi.fn();
    const handler = createWorkstationTaskCreateHandler({
      loadSession: async () => managerSession,
      createTask: vi.fn().mockRejectedValue(new Error("task_create_failed")),
      notifyTask,
    });

    const response = await handler(taskCreateRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "task_create_failed" });
    expect(notifyTask).not.toHaveBeenCalled();
  });
});
