import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkstationTaskHandler,
  defaultWorkstationTaskDependencies,
} from "@/app/api/workstation/tasks/[taskId]/handler";
import { getSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const taskId = "22222222-2222-4222-8222-222222222222";
const requestId = "67000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ taskId }) };
const session = { member: { id: 7 }, roleCodes: ["employee"] };
const canonicalTask = {
  id: taskId,
  projectId: "11111111-1111-4111-8111-111111111111",
  assigneeMemberId: "7",
  reporterMemberId: "8",
  title: "完成联调",
  description: "验证任务闭环",
  acceptanceCriteria: "负责人验收",
  status: "in_progress",
  priority: "high",
  startDate: "2026-08-20",
  dueDate: "2026-08-25",
  progress: 60,
  blocker: "",
  nextStep: "提交验收",
  resultText: "",
  resultLink: "",
  resultFiles: [],
  reviewNote: "",
  acceptedAt: "2026-08-20T01:00:00.000Z",
  submittedAt: null,
  reviewedAt: null,
  completedAt: null,
  version: 3,
  createdAt: "2026-08-19T01:00:00.000Z",
  updatedAt: "2026-08-20T02:00:00.000Z",
};
const commandResult = {
  outcome: "success",
  resource: "task",
  id: taskId,
  version: 3,
  entity: canonicalTask,
};

function request(body: unknown, key: string | null = requestId, contentType = "application/json") {
  const headers: Record<string, string> = { "content-type": contentType };
  if (key) headers["Idempotency-Key"] = key;
  return new Request(`https://workspace.test/api/workstation/tasks/${taskId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

function handler(overrides: Record<string, unknown> = {}) {
  return createWorkstationTaskHandler({
    loadSession: async () => session,
    mutateTask: vi.fn().mockResolvedValue(commandResult),
    ...overrides,
  } as never);
}

describe("formal workstation audited task transition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a session, JSON, a UUID request key, and a positive integer expected version", async () => {
    const mutateTask = vi.fn();
    const unauthenticated = handler({ loadSession: async () => null, mutateTask });
    expect((await unauthenticated(request({ action: "claim", expectedVersion: 1 }), context)).status).toBe(401);
    expect((await handler({ mutateTask })(request({ action: "claim", expectedVersion: 1 }, null), context)).status).toBe(400);
    expect((await handler({ mutateTask })(request({ action: "claim", expectedVersion: 1 }, "bad"), context)).status).toBe(400);
    expect((await handler({ mutateTask })(request({ action: "claim", expectedVersion: 1 }, requestId, "text/plain"), context)).status).toBe(415);
    for (const expectedVersion of [undefined, "2", 0, 1.5]) {
      const response = await handler({ mutateTask })(request({ action: "claim", expectedVersion }), context);
      expect(response.status).toBe(400);
    }
    expect(mutateTask).not.toHaveBeenCalled();
  });

  it("keeps actor identity out of the RPC payload and sends one canonical progress transition", async () => {
    const mutateTask = vi.fn().mockResolvedValue(commandResult);
    const response = await handler({ mutateTask })(request({
      action: "progress",
      expectedVersion: 2,
      progress: 60,
      blocker: "",
      nextStep: "提交验收",
    }), context);

    expect(response.status).toBe(200);
    expect(mutateTask).toHaveBeenCalledWith({
      taskId,
      action: "progress",
      expectedVersion: 2,
      payload: { progress: 60, blocker: "", nextStep: "提交验收" },
      requestId,
    });
    expect(await response.json()).toEqual({ task: expect.objectContaining({
      id: taskId, own: "m7", createdBy: "m8", st: "进行中", pr: 60, version: 3,
    }) });
  });

  it("validates every transition payload without numeric or enum coercion", async () => {
    const mutateTask = vi.fn();
    const invalid = [
      { action: ["claim"], expectedVersion: 1 },
      { action: "progress", expectedVersion: 1, progress: "60" },
      { action: "claim", expectedVersion: 1, actorMemberId: 999 },
      { action: "progress", expectedVersion: 1, progress: 60, blocker: [], nextStep: "x" },
      { action: "submit", expectedVersion: 1, resultText: "完成", resultLink: "file://local" },
      { action: "submit", expectedVersion: 1, resultText: "完成", resultLink: "", resultFiles: [] },
      { action: "review", expectedVersion: 1, decision: "reject", note: "" },
      { action: "review", expectedVersion: 1, decision: ["pass"], note: "" },
      { action: "reopen", expectedVersion: 1, note: "x", unexpected: true },
    ];
    for (const body of invalid) {
      expect((await handler({ mutateTask })(request(body), context)).status).toBe(400);
    }
    expect(mutateTask).not.toHaveBeenCalled();
  });

  it("maps version conflicts and authorization outcomes without leaking details", async () => {
    for (const [error, status] of [
      ["not_found", 404], ["forbidden", 403], ["version_conflict", 409],
      ["invalid_transition", 409], ["scope_conflict", 409], ["command_failed", 503],
    ] as const) {
      const response = await handler({
        mutateTask: vi.fn().mockResolvedValue({ outcome: "failure", error }),
      })(request({ action: "claim", expectedVersion: 1 }), context);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
    const sanitized = await handler({
      mutateTask: vi.fn().mockResolvedValue({ outcome: "failure", error: "sensitive procedure detail" }),
    })(request({ action: "claim", expectedVersion: 1 }), context);
    expect(sanitized.status).toBe(503);
    expect(await sanitized.json()).toEqual({ error: "command_failed" });
  });

  it("fails closed for malformed success and sanitizes database exceptions", async () => {
    const malformed = await handler({
      mutateTask: vi.fn().mockResolvedValue({ ...commandResult, version: 4 }),
    })(request({ action: "claim", expectedVersion: 2 }), context);
    expect(malformed.status).toBe(503);
    const rejected = await handler({
      mutateTask: vi.fn().mockRejectedValue(new Error("sensitive database error")),
    })(request({ action: "claim", expectedVersion: 2 }), context);
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toEqual({ error: "task_transition_unavailable" });
  });

  it("calls transition_current_task once and returns the database command result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: commandResult, error: null });
    vi.mocked(getSupabaseServerClient).mockResolvedValue({ rpc } as never);
    await expect(defaultWorkstationTaskDependencies.mutateTask({
      taskId,
      action: "submit",
      expectedVersion: 2,
      payload: {
        resultText: "交付完成",
        resultLink: "https://example.test/result",
        resultFiles: [],
      },
      requestId,
    })).resolves.toEqual(commandResult);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("transition_current_task", {
      task_public_id: taskId,
      command: "submit",
      expected_version: 2,
      payload: {
        resultText: "交付完成",
        resultLink: "https://example.test/result",
        resultFiles: [],
      },
      request_id: requestId,
    });
  });
});
