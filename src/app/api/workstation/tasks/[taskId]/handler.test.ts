import { describe, expect, it, vi } from "vitest";

import { createWorkstationTaskHandler } from "@/app/api/workstation/tasks/[taskId]/handler";

const context = {
  params: Promise.resolve({ taskId: "22222222-2222-4222-8222-222222222222" }),
};

describe("formal workstation task mutation", () => {
  it("uses the signed-in member as actor and ignores browser identity", async () => {
    const mutateTask = vi.fn().mockResolvedValue({ id: "task", st: "进行中", pr: 60 });
    const handler = createWorkstationTaskHandler({
      loadSession: async () => ({ member: { id: 7 }, roleCodes: ["employee"] }),
      mutateTask,
    });
    const response = await handler(
      new Request("https://workspace.test/api/workstation/tasks/task", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "progress",
          actorMemberId: 999,
          progress: 60,
          blocker: "",
          nextStep: "联调",
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mutateTask).toHaveBeenCalledWith({
      taskId: "22222222-2222-4222-8222-222222222222",
      actorMemberId: 7,
      roleCodes: ["employee"],
      action: "progress",
      progress: 60,
      blocker: "",
      nextStep: "联调",
    });
  });

  it("rejects malformed progress before reaching storage", async () => {
    const mutateTask = vi.fn();
    const handler = createWorkstationTaskHandler({
      loadSession: async () => ({ member: { id: 7 }, roleCodes: ["employee"] }),
      mutateTask,
    });
    const response = await handler(
      new Request("https://workspace.test/api/workstation/tasks/task", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "progress", progress: 120 }),
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mutateTask).not.toHaveBeenCalled();
  });

  it("requires an authenticated Feishu workspace session", async () => {
    const handler = createWorkstationTaskHandler({
      loadSession: async () => null,
      mutateTask: vi.fn(),
    });
    const response = await handler(
      new Request("https://workspace.test/api/workstation/tasks/task", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "claim" }),
      }),
      context,
    );
    expect(response.status).toBe(401);
  });
});
