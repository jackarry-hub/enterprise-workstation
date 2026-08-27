import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createProjectExecutionCommandHandler,
  type ProjectExecutionCommandDependencies,
} from "@/features/projects/execution-command-handler";

const projectId = "87000000-0000-4000-8000-000000000001";
const taskId = "87000000-0000-4000-8000-000000000002";
const dependencyId = "87000000-0000-4000-8000-000000000003";
const ownerId = "87000000-0000-4000-8000-000000000004";
const entityId = "87000000-0000-4000-8000-000000000005";
const key = "87000000-0000-4000-8000-000000000006";
const requestId = "87000000-0000-4000-8000-000000000007";

const managerSession = {
  member: { status: "active" },
  permissionCodes: ["project.manage"],
};

const memberSession = {
  member: { status: "active" },
  permissionCodes: ["project.read"],
};

function request(body: unknown, idempotencyKey = key) {
  return new Request("https://workspace.test/api/workstation/projects/resource", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

function dependencies(
  rpc: ProjectExecutionCommandDependencies["rpc"],
  session: ProjectExecutionCommandDependencies["session"] = managerSession,
): ProjectExecutionCommandDependencies {
  return { session, rpc, createRequestId: () => requestId };
}

describe("project execution command handler", () => {
  it("defers project-level manager authorization to the locked database command", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "failure", error: "forbidden" }, error: null,
    });
    const handler = createProjectExecutionCommandHandler("risk", dependencies(rpc, memberSession));
    const response = await handler(
      request({ title: "交付延期", level: "high", ownerPublicId: ownerId, deadline: "2026-09-30", reason: "登记风险" }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(rpc).toHaveBeenCalledWith("create_current_project_risk", expect.objectContaining({
      p_project_public_id: projectId,
    }));
  });

  it("creates a milestone through one scoped idempotent RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "success",
        resource: "milestone",
        id: entityId,
        version: 1,
        entity: {
          id: entityId,
          projectId,
          ownerPublicId: ownerId,
          name: "商业验收",
          description: "完成正式验收",
          status: "pending",
          startDate: "2026-09-01",
          dueDate: "2026-09-30",
          progress: 0,
          sortOrder: 1,
          version: 1,
          updatedAt: "2026-08-27T09:00:00.000Z",
        },
      },
      error: null,
    });
    const handler = createProjectExecutionCommandHandler("milestone", dependencies(rpc));
    const response = await handler(
      request({
        name: "商业验收", description: "完成正式验收", ownerPublicId: ownerId,
        startDate: "2026-09-01", dueDate: "2026-09-30", progress: 0, reason: "拆分交付阶段",
      }),
      { params: Promise.resolve({ projectId: projectId.toUpperCase() }) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      resource: "milestone",
      entity: expect.objectContaining({ id: entityId, projectId, version: 1 }),
    });
    expect(rpc).toHaveBeenCalledWith("create_current_project_milestone", expect.objectContaining({
      p_project_public_id: projectId,
      p_owner_employee_public_id: ownerId,
      p_progress: 0,
      idempotency_key: key,
      request_id: requestId,
    }));
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("tenantId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("organizationId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("actorId");
  });

  it("lets an active project member submit a strict server-scoped report", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "success", resource: "report", id: entityId, version: 1,
        entity: {
          id: entityId, projectId, authorPublicId: ownerId, reportDate: "2026-08-27",
          status: "submitted", summary: "完成联调", nextPlan: "完成验收", blockers: "",
          supportNeeded: "", version: 1, updatedAt: "2026-08-27T09:00:00.000Z",
        },
      },
      error: null,
    });
    const handler = createProjectExecutionCommandHandler("report", dependencies(rpc, memberSession));
    const response = await handler(
      request({ reportDate: "2026-08-27", summary: "完成联调", nextPlan: "完成验收", reason: "提交日报" }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("submit_current_project_report", expect.objectContaining({
      p_project_public_id: projectId,
      p_report_date: "2026-08-27",
      p_summary: "完成联调",
      p_next_plan: "完成验收",
    }));
  });

  it("rejects unknown browser fields, invalid dates, and coerced enums before RPC", async () => {
    const rpc = vi.fn();
    const risk = createProjectExecutionCommandHandler("risk", dependencies(rpc));
    const scoped = await risk(
      request({
        title: "风险", level: "high", ownerPublicId: ownerId, deadline: "2026-09-30",
        reason: "登记", unexpected: true,
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const enumArray = await risk(
      request({ title: "风险", level: ["high"], ownerPublicId: ownerId, deadline: "2026-09-30", reason: "登记" }),
      { params: Promise.resolve({ projectId }) },
    );
    const milestone = createProjectExecutionCommandHandler("milestone", dependencies(rpc));
    const invalidPeriod = await milestone(
      request({ name: "阶段", ownerPublicId: ownerId, startDate: "2026-10-01", dueDate: "2026-09-30", reason: "新增" }),
      { params: Promise.resolve({ projectId }) },
    );

    expect([scoped.status, enumArray.status, invalidPeriod.status]).toEqual([400, 400, 400]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects self-dependency and maps a database cycle to 422", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "failure", error: "task_dependency_cycle" }, error: null,
    });
    const handler = createProjectExecutionCommandHandler("dependency", dependencies(rpc));
    const self = await handler(
      request({ dependsOnTaskId: taskId, reason: "错误依赖" }),
      { params: Promise.resolve({ taskId }) },
    );
    expect(self.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();

    const cycle = await handler(
      request({ dependsOnTaskId: dependencyId, reason: "增加前置任务" }),
      { params: Promise.resolve({ taskId }) },
    );
    expect(cycle.status).toBe(422);
    expect(await cycle.json()).toEqual({ error: "task_dependency_cycle" });
  });

  it("rejects a malformed dependency identifier as bad input", async () => {
    const rpc = vi.fn();
    const handler = createProjectExecutionCommandHandler("dependency", dependencies(rpc));
    const response = await handler(
      request({ dependsOnTaskId: "not-a-uuid", reason: "增加前置任务" }),
      { params: Promise.resolve({ taskId }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates task comments without accepting a browser actor", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "success", resource: "comment", id: entityId, version: 1,
        entity: {
          id: entityId, taskId, projectId, authorPublicId: ownerId, body: "需要补充验收截图",
          version: 1, createdAt: "2026-08-27T09:00:00.000Z", updatedAt: "2026-08-27T09:00:00.000Z",
        },
      },
      error: null,
    });
    const handler = createProjectExecutionCommandHandler("comment", dependencies(rpc, memberSession));
    const response = await handler(
      request({ body: "需要补充验收截图", reason: "记录协作意见" }),
      { params: Promise.resolve({ taskId }) },
    );

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_current_task_comment", expect.objectContaining({
      p_task_public_id: taskId,
      p_body: "需要补充验收截图",
    }));
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("authorPublicId");
  });

  it("fails closed for malformed success and sanitizes unknown database failures", async () => {
    const malformedRpc = vi.fn().mockResolvedValue({
      data: { outcome: "success", resource: "risk", id: entityId, version: 1, entity: { secret: "no" } },
      error: null,
    });
    const malformed = await createProjectExecutionCommandHandler("risk", dependencies(malformedRpc))(
      request({ title: "风险", level: "high", ownerPublicId: ownerId, deadline: "2026-09-30", reason: "登记" }),
      { params: Promise.resolve({ projectId }) },
    );
    expect(malformed.status).toBe(503);
    expect(await malformed.json()).toEqual({ error: "project_execution_unavailable" });

    const unknownRpc = vi.fn().mockResolvedValue({
      data: { outcome: "failure", error: "raw trigger detail" }, error: null,
    });
    const unknown = await createProjectExecutionCommandHandler("activity", dependencies(unknownRpc, memberSession))(
      request({ content: "完成接口联调", reason: "记录项目动态" }),
      { params: Promise.resolve({ projectId }) },
    );
    expect(unknown.status).toBe(503);
    expect(await unknown.json()).toEqual({ error: "project_execution_unavailable" });
  });
});

describe("project execution command migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/202608270005_project_execution_commands.sql"),
    "utf8",
  ).toLowerCase();
  const milestoneAction = readFileSync(
    join(process.cwd(), "src/features/projects/actions/create-project-milestone.ts"),
    "utf8",
  );
  const concurrencySql = readFileSync(
    join(process.cwd(), "supabase/tests/project_execution_concurrency.sql"),
    "utf8",
  ).toLowerCase();

  it("adds exact tenant ownership, versioning, and idempotency to every command table", () => {
    expect(sql).toContain("create table public.project_execution_command_idempotency");
    for (const table of ["milestones", "project_risks", "project_activities", "daily_reports", "task_comments", "task_dependencies"]) {
      expect(sql).toContain(`alter table public.${table}`);
      expect(sql).toMatch(new RegExp(`alter table public\\.${table}[\\s\\S]*?tenant_id`));
    }
    expect(sql).toContain("version bigint");
    expect(sql).toContain("actor_member_id bigint not null");
    expect(sql).toContain("target_public_id uuid not null");
    expect(sql).toContain("payload_digest text not null");
    expect(sql).toContain("v_actor_member_id <> p_actor_member_id");
    expect(sql).toContain("v_target_public_id <> p_target_public_id");
    expect(sql).toContain("v_payload_digest <> v_expected_digest");
  });

  it("locks current access before replay and keeps internal helpers private", () => {
    expect(sql).toContain("create or replace function public.lock_current_project_execution_access");
    expect(sql).toContain("create or replace function public.lock_current_task_execution_access");
    expect(sql).toContain("for update of assignment, role");
    expect(sql).toContain("if v_replay then return v_claim -> 'result'; end if");
    expect(sql).toContain("audit_project_execution_replay_denied");
    for (const signature of [
      "lock_current_project_execution_access(bigint,bigint,bigint,uuid,text)",
      "lock_current_task_execution_access(bigint,bigint,bigint,uuid,text)",
      "claim_project_execution_command(bigint,bigint,bigint,text,uuid,jsonb,uuid,uuid)",
      "audit_project_execution_replay_denied(bigint,bigint,uuid,bigint,text,text,text,uuid,uuid,text,text)",
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")}[\\s\\S]*?from public, anon, authenticated, service_role`));
    }
  });

  it("binds every execution actor to the same organization as the resource", () => {
    for (const constraint of [
      "milestones_creator_organization_fkey", "milestones_updater_organization_fkey",
      "project_risks_creator_organization_fkey", "project_risks_updater_organization_fkey",
      "project_activities_actor_organization_fkey",
      "daily_reports_creator_organization_fkey", "daily_reports_updater_organization_fkey",
      "task_comments_creator_organization_fkey", "task_comments_updater_organization_fkey",
      "task_dependencies_creator_organization_fkey",
    ]) {
      expect(sql).toContain(`constraint ${constraint}`);
    }
  });

  it("exposes one typed RPC per resource and keeps browser DML closed", () => {
    for (const name of [
      "create_current_project_milestone", "create_current_project_risk",
      "record_current_project_activity", "submit_current_project_report",
      "create_current_task_comment", "create_current_task_dependency",
    ]) {
      expect(sql).toContain(`create or replace function public.${name}`);
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to authenticated`));
    }
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger on table public\.milestones[\s\S]*from public, anon, authenticated, service_role/);
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger on table public\.task_dependencies[\s\S]*from public, anon, authenticated, service_role/);
  });

  it("detects transitive dependency cycles and appends durable command audit", () => {
    const dependencyStart = sql.indexOf("create or replace function public.create_current_task_dependency");
    const dependencyEnd = sql.indexOf("$$;", dependencyStart);
    const dependency = sql.slice(dependencyStart, dependencyEnd);
    expect(dependency).toContain("with recursive");
    expect(dependency).toContain("task_dependency_cycle");
    expect(sql).toContain("public.complete_project_execution_command");
    expect(sql).toContain("public.append_audit_log");
    expect(sql).toContain("project.execution_failed");
    expect(sql).toContain("historical task dependency cycle must be resolved before upgrade");
    expect(sql).toContain("visited_task_ids");
    expect(sql).toContain("entitydigest");
    expect(sql).not.toContain("'after', case when p_outcome = 'success' then p_entity else null end");
  });

  it("makes resource mutation and project activity insertion one transaction", () => {
    for (const table of ["milestones", "project_risks", "daily_reports", "task_comments", "task_dependencies"]) {
      const operation = table === "milestones" ? "create_current_project_milestone"
        : table === "project_risks" ? "create_current_project_risk"
          : table === "daily_reports" ? "submit_current_project_report"
            : table === "task_comments" ? "create_current_task_comment"
              : "create_current_task_dependency";
      const start = sql.indexOf(`create or replace function public.${operation}`);
      const end = sql.indexOf("$$;", start);
      const block = sql.slice(start, end);
      expect(block).toContain(`insert into public.${table}`);
      expect(block).toContain("insert into public.project_activities");
      expect(block).toContain("complete_project_execution_command");
    }
  });

  it("routes the existing milestone UI through the transactional RPC", () => {
    expect(milestoneAction).toContain('.rpc("create_current_project_milestone"');
    expect(milestoneAction).toContain("idempotency_key: idempotencyKey");
    expect(milestoneAction).not.toContain('.from("milestones")');
    expect(milestoneAction).not.toContain("ownerMembershipId");
    expect(milestoneAction).toContain('["pending", "in_progress", "completed", "overdue"]');
  });

  it("keeps executable concurrency coverage for project and task commands", () => {
    expect(concurrencySql).toContain("select plan(7)");
    expect(concurrencySql).toContain("dblink_send_query");
    expect(concurrencySql).toContain("second same-key execution command waits on the first transaction");
    expect(concurrencySql).toContain("concurrent same-key milestone commands return one canonical row");
    expect(concurrencySql).toContain("opposing concurrent dependencies preserve one acyclic edge");
    expect(concurrencySql).toContain("second same-key task batch waits on the first durable claim");
    expect(concurrencySql).toContain("concurrent same-key task batches return one canonical task set");
    expect(concurrencySql).toContain("concurrent task transitions leave one winner and one version conflict");
  });
});
