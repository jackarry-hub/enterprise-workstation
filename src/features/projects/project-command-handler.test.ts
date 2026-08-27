import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  handleProjectArchiveCommand,
  handleProjectUpdateCommand,
} from "@/features/projects/project-command-handler";

const projectId = "82000000-0000-4000-8000-000000000001";
const ownerId = "82000000-0000-4000-8000-000000000002";
const key = "82000000-0000-4000-8000-000000000003";

const session = {
  member: { status: "active" },
  permissionCodes: ["project.manage"],
};

function commandRequest(method: string, body: unknown) {
  return new Request(`https://workspace.test/api/workstation/projects/${projectId}`, {
    method,
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

describe("project lifecycle command handler", () => {
  it("updates through one versioned RPC without trusting client scope", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "success", id: projectId, version: 3 }, error: null,
    });
    const response = await handleProjectUpdateCommand(
      commandRequest("PATCH", {
        name: "真实交付项目", ownerPublicId: ownerId, budgetAmount: "88.20",
        description: "正式交付", category: "企业项目", priority: "medium",
        startsOn: "2026-09-01", dueOn: "2026-09-30", version: 2, reason: "调整交付范围",
      }),
      { params: Promise.resolve({ projectId: projectId.toUpperCase() }) },
      { session, rpc, createRequestId: () => "82000000-0000-4000-8000-000000000004" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "success", id: projectId, version: 3 });
    expect(rpc).toHaveBeenCalledWith("update_current_project", expect.objectContaining({
      p_project_public_id: projectId,
      p_owner_employee_public_id: ownerId,
      p_budget_amount: "88.20",
      p_expected_version: 2,
      idempotency_key: key,
    }));
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("tenantId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("organizationId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("actorId");
  });

  it("archives with optimistic version and maps a stale result to 409", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "failure", error: "stale_version" }, error: null,
    });
    const response = await handleProjectArchiveCommand(
      commandRequest("DELETE", { version: 4, reason: "项目终止" }),
      { params: Promise.resolve({ projectId }) },
      { session, rpc },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "stale_version" });
  });

  it("fails closed for malformed RPC success data", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "success", id: ownerId, version: 3, secret: "no" }, error: null,
    });
    const response = await handleProjectUpdateCommand(
      commandRequest("PATCH", {
        name: "真实交付项目", ownerPublicId: ownerId, budgetAmount: "1.00",
        description: "正式交付", category: "企业项目", priority: "medium",
        startsOn: "2026-09-01", dueOn: "2026-09-30", version: 2, reason: "调整",
      }),
      { params: Promise.resolve({ projectId }) },
      { session, rpc },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "project_command_unavailable" });
  });

  it("rejects coerced enum input and sanitizes unknown command failures", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "failure", error: "internal trigger diagnostic" }, error: null,
    });
    const invalid = await handleProjectUpdateCommand(
      commandRequest("PATCH", {
        name: "真实交付项目", ownerPublicId: ownerId, budgetAmount: "1.00",
        description: "正式交付", category: "企业项目",
        startsOn: "2026-09-01", dueOn: "2026-09-30", version: 2,
        reason: "调整", priority: ["medium"],
      }),
      { params: Promise.resolve({ projectId }) },
      { session, rpc },
    );
    expect(invalid.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();

    const unknown = await handleProjectArchiveCommand(
      commandRequest("DELETE", { version: 2, reason: "归档" }),
      { params: Promise.resolve({ projectId }) },
      { session, rpc },
    );
    expect(unknown.status).toBe(503);
    expect(await unknown.json()).toEqual({ error: "project_command_unavailable" });
  });

  it("enforces JSON media type, the 32 KiB limit and exact operation fields", async () => {
    const rpc = vi.fn();
    const extra = await handleProjectArchiveCommand(
      commandRequest("DELETE", { version: 2, reason: "归档", arbitrary: true }),
      { params: Promise.resolve({ projectId }) }, { session, rpc },
    );
    expect(extra.status).toBe(400);

    const wrongMedia = await handleProjectArchiveCommand(new Request(
      `https://workspace.test/api/workstation/projects/${projectId}`,
      { method: "DELETE", headers: { "content-type": "text/plain", "Idempotency-Key": key }, body: "{}" },
    ), { params: Promise.resolve({ projectId }) }, { session, rpc });
    expect(wrongMedia.status).toBe(415);

    const oversized = await handleProjectArchiveCommand(new Request(
      `https://workspace.test/api/workstation/projects/${projectId}`,
      { method: "DELETE", headers: { "content-type": "application/json", "content-length": "32769",
        "Idempotency-Key": key }, body: JSON.stringify({ version: 2, reason: "归档" }) },
    ), { params: Promise.resolve({ projectId }) }, { session, rpc });
    expect(oversized.status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("project lifecycle migration", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/202608270004_project_lifecycle_commands.sql"), "utf8").toLowerCase();

  it("adds tenant money version ownership and archive authority", () => {
    expect(sql).toContain("alter table public.projects");
    expect(sql).toContain("budget_amount numeric(18, 2)");
    expect(sql).toContain("version bigint");
    expect(sql).toContain("archived_at timestamptz");
    expect(sql).toContain("updated_by_member_id bigint");
    expect(sql).toContain("create table public.project_command_idempotency");
  });

  it("keeps create membership and audit in one database transaction", () => {
    const start = sql.indexOf("create or replace function public.create_current_project_v2");
    const end = sql.indexOf("$$;", start);
    const block = sql.slice(start, end);
    expect(block).toContain("insert into public.projects");
    expect(block).toContain("insert into public.project_members");
    expect(block).toContain("public.complete_project_command");
    expect(sql.slice(
      sql.indexOf("create or replace function public.complete_project_command"),
      sql.indexOf("create or replace function public.audit_project_scope_conflict"),
    )).toContain("public.append_audit_log");
    expect(block).toContain("idempotency_key");
    expect(block).not.toContain("service_role");
  });

  it("removes browser direct writes and exposes only authenticated commands", () => {
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger on table public\.projects[\s\S]*from public, anon, authenticated, service_role/);
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger on table public\.project_members[\s\S]*from public, anon, authenticated, service_role/);
    expect(sql).toMatch(/grant execute on function public\.create_current_project_v2[\s\S]*to authenticated/);
    expect(sql).toMatch(/grant execute on function public\.update_current_project[\s\S]*to authenticated/);
    expect(sql).toMatch(/grant execute on function public\.archive_current_project[\s\S]*to authenticated/);
    expect(sql).toMatch(/revoke all on function public\.create_current_project\([\s\S]*from public, anon, authenticated, service_role/);
  });

  it("keeps the existing task-create RPC compatible with hardened memberships", () => {
    const start = sql.indexOf("create or replace function public.create_current_project_task_v2");
    const end = sql.indexOf("$$;", start);
    const block = sql.slice(start, end);
    expect(block).toContain("tenant_id, organization_id, project_id, member_id");
    expect(block).toContain("created_by_member_id, updated_by_member_id, version");
    expect(block).toContain("membership.version + 1");
  });
});
