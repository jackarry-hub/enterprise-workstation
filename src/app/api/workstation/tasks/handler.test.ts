import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkstationTaskCreateHandler,
  defaultWorkstationTaskCreateDependencies,
} from "@/app/api/workstation/tasks/handler";
import { getSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const tenantId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "44444444-4444-4444-8444-444444444444";
const key = "65000000-0000-4000-8000-000000000001";
const managerSession = {
  tenantId,
  organization: { id: organizationId },
  member: { id: 7 },
  permissionCodes: ["task.manage"],
};
const validBody = {
  projectId,
  assigneeMemberId: "m8",
  title: "完成飞书协作联调",
  description: "验证员工领取、提交和负责人验收",
  acceptanceCriteria: "负责人验收通过",
  dueDate: "2026-08-25",
  priority: "P1",
};
const canonicalTask = {
  id: taskId,
  projectId,
  assigneeMemberId: "8",
  reporterMemberId: "7",
  title: validBody.title,
  description: validBody.description,
  acceptanceCriteria: validBody.acceptanceCriteria,
  status: "todo",
  priority: "high",
  startDate: "2026-08-20",
  dueDate: validBody.dueDate,
  progress: 0,
  blocker: "",
  nextStep: "",
  resultText: "",
  resultLink: "",
  resultFiles: [],
  reviewNote: "",
  acceptedAt: null,
  submittedAt: null,
  reviewedAt: null,
  completedAt: null,
  version: 1,
  createdAt: "2026-08-20T01:00:00.000Z",
  updatedAt: "2026-08-20T01:00:00.000Z",
};
const commandResult = {
  outcome: "success", resource: "task_batch", id: key, version: 1,
  taskIds: [taskId], tasks: [canonicalTask],
};

function request(body: unknown = validBody, idempotencyKey: string | null = key) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return new Request("https://workspace.test/api/workstation/tasks", {
    method: "POST", headers, body: JSON.stringify(body),
  });
}

function handler(overrides: Record<string, unknown> = {}) {
  return createWorkstationTaskCreateHandler({
    loadSession: async () => managerSession,
    createTask: vi.fn().mockResolvedValue(commandResult),
    notifyTask: vi.fn().mockResolvedValue({ status: "sent" }),
    ...overrides,
  } as never);
}

describe("formal workstation idempotent single task creation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication and a UUID idempotency key while deferring project ACLs to the database", async () => {
    const createTask = vi.fn();
    const notifyTask = vi.fn();
    expect((await handler({ loadSession: async () => null, createTask, notifyTask })(request())).status).toBe(401);
    expect((await handler({ createTask, notifyTask })(request(validBody, null))).status).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
    expect(notifyTask).not.toHaveBeenCalled();

    const projectManagerCreate = vi.fn().mockResolvedValue(commandResult);
    expect((await handler({
      loadSession: async () => ({ ...managerSession, permissionCodes: [] }),
      createTask: projectManagerCreate,
    })(request())).status).toBe(201);
    expect(projectManagerCreate).toHaveBeenCalledOnce();
  });

  it("rejects spoofed or malformed fields before storage", async () => {
    const createTask = vi.fn();
    const invalid = [
      { ...validBody, reporterMemberId: 999 },
      { ...validBody, dueDate: "2026-02-31" },
      { ...validBody, assigneeMemberId: "m0" },
      { ...validBody, priority: "urgent" },
    ];
    for (const body of invalid) {
      expect((await handler({ createTask })(request(body))).status).toBe(400);
    }
    expect(createTask).not.toHaveBeenCalled();
  });

  it("creates through the one-item batch command before notifying the canonical task ID", async () => {
    const events: string[] = [];
    const createTask = vi.fn().mockImplementation(async () => { events.push("created"); return commandResult; });
    const notifyTask = vi.fn().mockImplementation(async () => { events.push("notified"); return { status: "sent" }; });
    const response = await handler({ createTask, notifyTask })(request());
    expect(response.status).toBe(201);
    expect(events).toEqual(["created", "notified"]);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId, assigneeMemberId: 8, priority: "high", idempotencyKey: key,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
    expect(createTask.mock.calls[0]?.[0].requestId).not.toBe(key);
    expect(notifyTask).toHaveBeenCalledWith({ tenantId, organizationId, taskId });
    expect(await response.json()).toEqual({
      task: expect.objectContaining({ id: taskId, own: "m8", createdBy: "m7", version: 1 }),
      notification: { status: "sent" },
    });
  });

  it("preserves low priority through the P3 public protocol", async () => {
    const createTask = vi.fn().mockResolvedValue({
      ...commandResult,
      tasks: [{ ...canonicalTask, priority: "low" }],
    });
    const response = await handler({ createTask })(request({ ...validBody, priority: "P3" }));
    expect(response.status).toBe(201);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ priority: "low" }));
    expect((await response.json()).task.pri).toBe("P3");
  });

  it.each([
    { status: "failed", errorCode: "send_failed" },
    { status: "unavailable", errorCode: "recipient_unavailable" },
    { status: "unavailable", errorCode: "delivery_unconfirmed" },
  ] as const)("keeps the committed task when notification returns $status", async (notification) => {
    const response = await handler({ notifyTask: vi.fn().mockResolvedValue(notification) })(request());
    expect(response.status).toBe(201);
    expect((await response.json()).notification).toEqual(notification);
  });

  it("normalizes notifier exceptions without exposing provider details", async () => {
    const response = await handler({
      notifyTask: vi.fn().mockRejectedValue(new Error("secret provider response")),
    })(request());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.notification).toEqual({ status: "failed", errorCode: "send_failed" });
    expect(JSON.stringify(body)).not.toContain("secret provider response");
  });

  it("maps database domain failures and never notifies", async () => {
    const notifyTask = vi.fn();
    for (const [error, status] of [["forbidden", 403], ["not_found", 404], ["scope_conflict", 409]] as const) {
      const response = await handler({
        createTask: vi.fn().mockResolvedValue({ outcome: "failure", error }), notifyTask,
      })(request());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
    const sanitized = await handler({
      createTask: vi.fn().mockResolvedValue({ outcome: "failure", error: "relation internal_tasks leaked" }),
      notifyTask,
    })(request());
    expect(sanitized.status).toBe(503);
    expect(await sanitized.json()).toEqual({ error: "command_failed" });
    expect(notifyTask).not.toHaveBeenCalled();
  });

  it("calls create_current_task_batch_v3 once in the default dependency", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: commandResult, error: null });
    vi.mocked(getSupabaseServerClient).mockResolvedValue({ rpc } as never);
    await expect(defaultWorkstationTaskCreateDependencies.createTask({
      ...validBody,
      assigneeMemberId: 8,
      priority: "high",
      idempotencyKey: key,
      requestId: "65000000-0000-4000-8000-000000000002",
    })).resolves.toEqual(commandResult);
    expect(rpc).toHaveBeenCalledWith("create_current_task_batch_v3", expect.objectContaining({
      items: [expect.objectContaining({ projectId, assigneeMemberId: 8 })],
      idempotency_key: key,
      request_id: "65000000-0000-4000-8000-000000000002",
    }));
  });
});
