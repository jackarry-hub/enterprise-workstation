import { describe, expect, it, vi } from "vitest";

import { createWorkstationTaskBatchHandler } from "@/app/api/workstation/tasks/batch/handler";

const tenantId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const managerSession = {
  tenantId,
  organization: { id: organizationId },
  member: { id: 7 },
  permissionCodes: ["task.manage"],
};
const taskBody = {
  projectId: "11111111-1111-4111-8111-111111111111",
  assigneeMemberId: "m8",
  title: "完成飞书协作联调",
  description: "验证领取和提交",
  acceptanceCriteria: "负责人验收通过",
  dueDate: "2026-08-25",
  priority: "P1",
};

function request(body: unknown) {
  return new Request("https://workspace.test/api/workstation/tasks/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("formal workstation batch task creation", () => {
  it("requires task management permission", async () => {
    const createTask = vi.fn();
    const notifyTasks = vi.fn();
    const handler = createWorkstationTaskBatchHandler({
      loadSession: async () => ({ ...managerSession, permissionCodes: [] }),
      createTask,
      notifyTasks,
    });

    const response = await handler(request({ tasks: [taskBody] }));

    expect(response.status).toBe(403);
    expect(createTask).not.toHaveBeenCalled();
    expect(notifyTasks).not.toHaveBeenCalled();
  });

  it("rejects an empty batch or more than twenty tasks before writing", async () => {
    const createTask = vi.fn();
    const handler = createWorkstationTaskBatchHandler({
      loadSession: async () => managerSession,
      createTask,
      notifyTasks: vi.fn(),
    });

    expect((await handler(request({ tasks: [] }))).status).toBe(400);
    expect((await handler(request({ tasks: Array.from({ length: 21 }, () => taskBody) }))).status).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("creates every task before one grouped notification dispatch", async () => {
    const events: string[] = [];
    const created = [
      { id: "44444444-4444-4444-8444-444444444444", n: "任务一" },
      { id: "55555555-5555-4555-8555-555555555555", n: "任务二" },
    ];
    const createTask = vi.fn()
      .mockImplementationOnce(async () => { events.push("create-1"); return created[0]; })
      .mockImplementationOnce(async () => { events.push("create-2"); return created[1]; });
    const notifyTasks = vi.fn().mockImplementation(async () => {
      events.push("notify");
      return {
        [created[0].id]: { status: "sent" as const },
        [created[1].id]: { status: "unavailable" as const, errorCode: "recipient_unavailable" as const },
      };
    });
    const handler = createWorkstationTaskBatchHandler({
      loadSession: async () => managerSession,
      createTask,
      notifyTasks,
    });

    const response = await handler(request({
      tasks: [taskBody, { ...taskBody, title: "整理验收清单", assigneeMemberId: "m9" }],
    }));

    expect(response.status).toBe(201);
    expect(events).toEqual(["create-1", "create-2", "notify"]);
    expect(createTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      actorMemberId: 7,
      assigneeMemberId: 8,
      priority: "high",
    }));
    expect(createTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      actorMemberId: 7,
      assigneeMemberId: 9,
      title: "整理验收清单",
    }));
    expect(notifyTasks).toHaveBeenCalledWith([
      { tenantId, organizationId, taskId: created[0].id },
      { tenantId, organizationId, taskId: created[1].id },
    ]);
    await expect(response.json()).resolves.toEqual({
      tasks: [
        { task: created[0], notification: { status: "sent" } },
        { task: created[1], notification: { status: "unavailable", errorCode: "recipient_unavailable" } },
      ],
    });
  });

  it("rejects the whole request when one task body is malformed", async () => {
    const createTask = vi.fn();
    const handler = createWorkstationTaskBatchHandler({
      loadSession: async () => managerSession,
      createTask,
      notifyTasks: vi.fn(),
    });

    const response = await handler(request({
      tasks: [taskBody, { ...taskBody, assigneeMemberId: "m0" }],
    }));

    expect(response.status).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("returns stable notification errors without leaking provider details", async () => {
    const created = { id: "44444444-4444-4444-8444-444444444444" };
    const handler = createWorkstationTaskBatchHandler({
      loadSession: async () => managerSession,
      createTask: vi.fn().mockResolvedValue(created),
      notifyTasks: vi.fn().mockRejectedValue(new Error("secret provider response")),
    });

    const response = await handler(request({ tasks: [taskBody] }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      tasks: [{
        task: created,
        notification: { status: "failed", errorCode: "send_failed" },
      }],
    });
    expect(JSON.stringify(body)).not.toContain("secret provider response");
  });
});
