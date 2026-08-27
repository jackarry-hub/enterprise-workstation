import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkstationTaskBatchHandler,
  defaultWorkstationTaskBatchDependencies,
} from "@/app/api/workstation/tasks/batch/handler";
import { getSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const tenantId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const projectId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "66000000-0000-4000-8000-000000000001";
const taskIds = [
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];
const managerSession = {
  tenantId,
  organization: { id: organizationId },
  member: { id: 7 },
  permissionCodes: ["task.manage"],
};
const taskBody = {
  projectId,
  assigneeMemberId: "m8",
  title: "完成飞书协作联调",
  description: "验证领取和提交",
  acceptanceCriteria: "负责人验收通过",
  dueDate: "2026-08-25",
  priority: "P1",
};

const canonicalTasks = taskIds.map((id, index) => ({
  id,
  projectId,
  assigneeMemberId: String(8 + index),
  reporterMemberId: "7",
  title: index === 0 ? taskBody.title : "整理验收清单",
  description: taskBody.description,
  acceptanceCriteria: taskBody.acceptanceCriteria,
  status: "todo",
  priority: "high",
  startDate: "2026-08-20",
  dueDate: taskBody.dueDate,
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
}));
const batchResult = {
  outcome: "success",
  resource: "task_batch",
  id: idempotencyKey,
  version: 1,
  taskIds,
  tasks: canonicalTasks,
};

function request(body: unknown, key: string | null = idempotencyKey, contentType = "application/json") {
  const headers: Record<string, string> = { "content-type": contentType };
  if (key) headers["Idempotency-Key"] = key;
  return new Request("https://workspace.test/api/workstation/tasks/batch", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    loadSession: async () => managerSession,
    createBatch: vi.fn().mockResolvedValue(batchResult),
    notifyTasks: vi.fn().mockResolvedValue({
      [taskIds[0]]: { status: "sent" },
      [taskIds[1]]: { status: "unavailable", errorCode: "recipient_unavailable" },
    }),
    ...overrides,
  };
}

describe("formal workstation atomic task batch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a session, JSON, and a UUID key while deferring project ACLs to the database", async () => {
    const createBatch = vi.fn();
    const notifyTasks = vi.fn();
    const unauthenticated = createWorkstationTaskBatchHandler(dependencies({
      loadSession: async () => null, createBatch, notifyTasks,
    }) as never);
    const handler = createWorkstationTaskBatchHandler(dependencies({ createBatch, notifyTasks }) as never);

    expect((await unauthenticated(request({ tasks: [taskBody] }))).status).toBe(401);
    expect((await handler(request({ tasks: [taskBody] }, null))).status).toBe(400);
    expect((await handler(request({ tasks: [taskBody] }, "not-a-uuid"))).status).toBe(400);
    expect((await handler(request({ tasks: [taskBody] }, idempotencyKey, "text/plain"))).status).toBe(415);
    expect(createBatch).not.toHaveBeenCalled();
    expect(notifyTasks).not.toHaveBeenCalled();

    const projectManagerCreate = vi.fn().mockResolvedValue({ ...batchResult, taskIds: [taskIds[0]], tasks: [canonicalTasks[0]] });
    const projectManager = createWorkstationTaskBatchHandler(dependencies({
      loadSession: async () => ({ ...managerSession, permissionCodes: [] }),
      createBatch: projectManagerCreate,
      notifyTasks: vi.fn().mockResolvedValue({ [taskIds[0]]: { status: "sent" } }),
    }) as never);
    expect((await projectManager(request({ tasks: [taskBody] }))).status).toBe(201);
    expect(projectManagerCreate).toHaveBeenCalledOnce();
  });

  it("rejects the whole request before storage when any of one to twenty strict items is invalid", async () => {
    const createBatch = vi.fn();
    const handler = createWorkstationTaskBatchHandler(dependencies({ createBatch }) as never);
    const invalidBodies = [
      { tasks: [] },
      { tasks: Array.from({ length: 21 }, () => taskBody) },
      { tasks: [taskBody, { ...taskBody, assigneeMemberId: "m0" }] },
      { tasks: [{ ...taskBody, dueDate: "2026-02-31" }] },
      { tasks: [{ ...taskBody, priority: "urgent" }] },
      { tasks: [{ ...taskBody, unexpected: true }] },
      { tasks: [taskBody], unexpected: true },
    ];
    for (const body of invalidBodies) {
      expect((await handler(request(body))).status).toBe(400);
    }
    expect(createBatch).not.toHaveBeenCalled();
  });

  it("calls one transactional command, then dispatches grouped notifications from canonical IDs", async () => {
    const events: string[] = [];
    const createBatch = vi.fn().mockImplementation(async () => {
      events.push("batch");
      return batchResult;
    });
    const notifyTasks = vi.fn().mockImplementation(async () => {
      events.push("notify");
      return {
        [taskIds[0]]: { status: "sent" as const },
        [taskIds[1]]: { status: "unavailable" as const, errorCode: "recipient_unavailable" as const },
      };
    });
    const handler = createWorkstationTaskBatchHandler(dependencies({ createBatch, notifyTasks }) as never);
    const response = await handler(request({
      tasks: [taskBody, { ...taskBody, title: "整理验收清单", assigneeMemberId: "m9" }],
    }));

    expect(response.status).toBe(201);
    expect(events).toEqual(["batch", "notify"]);
    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      items: [
        expect.objectContaining({ projectId, assigneeMemberId: 8, priority: "high" }),
        expect.objectContaining({ title: "整理验收清单", assigneeMemberId: 9 }),
      ],
    }));
    expect(createBatch.mock.calls[0]?.[0].requestId).not.toBe(idempotencyKey);
    expect(notifyTasks).toHaveBeenCalledWith(taskIds.map((taskId) => ({
      tenantId, organizationId, taskId,
    })));
    const body = await response.json();
    expect(body.tasks.map((row: { task: { id: string } }) => row.task.id)).toEqual(taskIds);
    expect(body.tasks[0].task).toEqual(expect.objectContaining({
      id: taskIds[0], own: "m8", createdBy: "m7", reviewer: "m7", st: "待处理", pri: "P1", version: 1,
    }));
  });

  it("returns stable domain failures and never notifies a rejected batch", async () => {
    const notifyTasks = vi.fn();
    for (const [error, status] of [
      ["forbidden", 403], ["not_found", 404], ["scope_conflict", 409], ["command_failed", 503],
    ] as const) {
      const handler = createWorkstationTaskBatchHandler(dependencies({
        createBatch: vi.fn().mockResolvedValue({ outcome: "failure", error }), notifyTasks,
      }) as never);
      const response = await handler(request({ tasks: [taskBody] }));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
    const sanitized = createWorkstationTaskBatchHandler(dependencies({
      createBatch: vi.fn().mockResolvedValue({ outcome: "failure", error: "internal table name" }),
      notifyTasks,
    }) as never);
    const sanitizedResponse = await sanitized(request({ tasks: [taskBody] }));
    expect(sanitizedResponse.status).toBe(503);
    expect(await sanitizedResponse.json()).toEqual({ error: "command_failed" });
    expect(notifyTasks).not.toHaveBeenCalled();
  });

  it("fails closed for malformed command success and sanitizes database exceptions", async () => {
    const malformed = createWorkstationTaskBatchHandler(dependencies({
      createBatch: vi.fn().mockResolvedValue({ ...batchResult, taskIds: [taskIds[0]] }),
    }) as never);
    const rejected = createWorkstationTaskBatchHandler(dependencies({
      createBatch: vi.fn().mockRejectedValue(new Error("sensitive database detail")),
    }) as never);
    expect((await malformed(request({ tasks: [taskBody] }))).status).toBe(503);
    const response = await rejected(request({ tasks: [taskBody] }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "task_batch_unavailable" });
  });

  it("calls create_current_task_batch_v3 exactly once in the default dependency", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: batchResult, error: null });
    vi.mocked(getSupabaseServerClient).mockResolvedValue({ rpc } as never);
    await expect(defaultWorkstationTaskBatchDependencies.createBatch({
      items: [{ ...taskBody, assigneeMemberId: 8, priority: "high" }],
      idempotencyKey,
      requestId: "66000000-0000-4000-8000-000000000002",
    })).resolves.toEqual(batchResult);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_current_task_batch_v3", expect.objectContaining({
      idempotency_key: idempotencyKey,
      request_id: "66000000-0000-4000-8000-000000000002",
    }));
  });
});

describe("task command migration contract", () => {
  it("defines forward-only tenant, version, idempotency, audit, and closed-DML controls", () => {
    const sql = `${readFileSync(
      join(process.cwd(), "supabase/migrations/202608270006_task_command_v2.sql"),
      "utf8",
    )}\n${readFileSync(
      join(process.cwd(), "supabase/migrations/202608270011_project_commercial_completion.sql"),
      "utf8",
    )}`.toLowerCase();
    expect(sql).toContain("alter table public.tasks");
    expect(sql).toContain("tenant_id bigint");
    expect(sql).toContain("version bigint not null default 1");
    expect(sql).toContain("create table public.task_command_idempotency");
    expect(sql).toContain("create or replace function public.create_current_task_batch_v3");
    expect(sql).toContain("create or replace function public.transition_current_task");
    expect(sql).toContain("task.batch_created");
    expect(sql).toContain("task.submitted");
    expect(sql).toMatch(/revoke all on function public\.create_current_project_task\(uuid,text,text,bigint,date,text\)[\s\S]*from public, anon, authenticated, service_role/);
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger on table public\.tasks[\s\S]*from public, anon, authenticated, service_role/);
  });

  it("keeps deterministic locks and real concurrent replay/version proofs in the release suite", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/202608270006_task_command_v2.sql"),
      "utf8",
    ).toLowerCase();
    const concurrency = readFileSync(
      join(process.cwd(), "supabase/tests/project_execution_concurrency.sql"),
      "utf8",
    ).toLowerCase();
    expect(migration).toMatch(/select distinct[\s\S]*order by 1[\s\S]*lock_current_project_execution_access/);
    expect(migration).toMatch(/from public\.task_command_idempotency ledger[\s\S]*for update/);
    expect(migration).toMatch(/select distinct candidate\.member_id[\s\S]*select v_actor::bigint as member_id[\s\S]*order by candidate\.member_id/);
    const projectPrelock = migration.indexOf("establish one global lock order");
    const actorMemberLock = migration.indexOf("select distinct candidate.member_id");
    const accessCheck = migration.indexOf("for v_project_public_id in", actorMemberLock);
    expect(projectPrelock).toBeGreaterThan(-1);
    expect(actorMemberLock).toBeGreaterThan(projectPrelock);
    expect(accessCheck).toBeGreaterThan(actorMemberLock);
    const guardDrop = migration.indexOf("drop trigger if exists tasks_member_execution_fields_guard");
    const backfill = migration.indexOf("update public.tasks task");
    const guardRestore = migration.indexOf("create trigger tasks_member_execution_fields_guard");
    expect(guardDrop).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(guardDrop);
    expect(guardRestore).toBeGreaterThan(backfill);
    expect(migration).toContain("role = case when membership.role = 'viewer' then 'member'");
    expect(concurrency).toContain("second same-key task batch waits on the first durable claim");
    expect(concurrency).toContain("concurrent same-key task batches return one canonical task set");
    expect(concurrency).toContain("concurrent task transitions leave one winner and one version conflict");
  });
});
