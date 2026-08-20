import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkstationTaskHandler,
  defaultWorkstationTaskDependencies,
} from "@/app/api/workstation/tasks/[taskId]/handler";
import { getSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

const context = {
  params: Promise.resolve({ taskId: "22222222-2222-4222-8222-222222222222" }),
};

describe("formal workstation task mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("lets the assigned employee accept a pending task and records the acceptance time", async () => {
    const current = {
      public_id: "22222222-2222-4222-8222-222222222222",
      assignee_member_id: 7,
      reporter_member_id: 8,
      status: "todo",
      progress: 0,
    };
    const updated = {
      ...current,
      status: "in_progress",
      accepted_at: "2026-08-19T01:02:03.000Z",
      blocker: null,
      next_step: "",
      result_summary: "",
      result_link: "",
      result_files: [],
      review_note: "",
    };
    const filters: Array<[string, unknown]> = [];
    let changes: Record<string, unknown> | null = null;
    const readQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: current, error: null }),
    };
    const updateQuery = {
      update: vi.fn((value: Record<string, unknown>) => {
        changes = value;
        return updateQuery;
      }),
      eq: vi.fn((name: string, value: unknown) => {
        filters.push([name, value]);
        return updateQuery;
      }),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updated, error: null }),
    };
    const client = {
      from: vi.fn()
        .mockReturnValueOnce(readQuery)
        .mockReturnValueOnce(updateQuery),
    };
    vi.mocked(getSupabaseServerClient).mockResolvedValue(client as never);

    const task = await defaultWorkstationTaskDependencies.mutateTask({
      taskId: current.public_id,
      actorMemberId: 7,
      roleCodes: ["employee"],
      action: "claim",
    });

    expect(changes).toEqual(expect.objectContaining({
      status: "in_progress",
      accepted_at: expect.any(String),
    }));
    expect(changes).not.toHaveProperty("assignee_member_id");
    expect(changes).not.toHaveProperty("start_date");
    expect(filters).toContainEqual(["assignee_member_id", 7]);
    expect(task).toEqual(expect.objectContaining({
      id: current.public_id,
      own: "m7",
      st: "进行中",
      acceptedAt: updated.accepted_at,
    }));
  });
});
