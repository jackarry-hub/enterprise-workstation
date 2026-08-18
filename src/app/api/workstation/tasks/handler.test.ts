import { describe, expect, it, vi } from "vitest";

import { createWorkstationTaskCreateHandler } from "@/app/api/workstation/tasks/handler";

const validBody = {
  projectId: "11111111-1111-4111-8111-111111111111",
  assigneeMemberId: "m8",
  title: "完成飞书协作联调",
  description: "验证员工领取、提交和负责人验收",
  acceptanceCriteria: "负责人验收通过",
  dueDate: "2026-08-25",
  priority: "P1",
};

describe("formal workstation task creation", () => {
  it("requires task management permission", async () => {
    const createTask = vi.fn();
    const handler = createWorkstationTaskCreateHandler({
      loadSession: async () => ({
        member: { id: 7 },
        permissionCodes: ["task.execute"],
      }),
      createTask,
    });

    const response = await handler(new Request("https://workspace.test/api/workstation/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    }));

    expect(response.status).toBe(403);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("creates the task with the signed-in member as reporter", async () => {
    const createTask = vi.fn().mockResolvedValue({ id: "task-1", st: "待处理" });
    const handler = createWorkstationTaskCreateHandler({
      loadSession: async () => ({
        member: { id: 7 },
        permissionCodes: ["task.manage"],
      }),
      createTask,
    });

    const response = await handler(new Request("https://workspace.test/api/workstation/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, reporterMemberId: 999 }),
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
  });

  it("rejects malformed task input", async () => {
    const createTask = vi.fn();
    const handler = createWorkstationTaskCreateHandler({
      loadSession: async () => ({
        member: { id: 7 },
        permissionCodes: ["task.manage"],
      }),
      createTask,
    });

    const response = await handler(new Request("https://workspace.test/api/workstation/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, assigneeMemberId: "m0" }),
    }));

    expect(response.status).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });
});
