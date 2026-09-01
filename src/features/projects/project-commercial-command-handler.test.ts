import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  handleNotificationReadCommand,
  handleProjectMemberCommand,
  handleProjectRestoreCommand,
} from "@/features/projects/project-commercial-command-handler";

const projectId = "84000000-0000-4000-8000-000000000001";
const employeeId = "84000000-0000-4000-8000-000000000002";
const membershipId = "84000000-0000-4000-8000-000000000003";
const notificationId = "84000000-0000-4000-8000-000000000004";
const key = "84000000-0000-4000-8000-000000000005";
const requestId = "84000000-0000-4000-8000-000000000006";
const session = { member: { status: "active" }, permissionCodes: ["project.manage"] };

function request(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

describe("project commercial command handlers", () => {
  it("adds a member through one exact-scope CAS RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      outcome: "success", resource: "project_member", id: membershipId, version: 1,
      entity: { id: membershipId, projectId, employeePublicId: employeeId, role: "member",
        allocationPercent: 80, version: 1, projectVersion: 4, leftAt: null },
    }, error: null });
    const response = await handleProjectMemberCommand(
      request(`https://workspace.test/api/workstation/projects/${projectId}/members`, "POST", {
        command: "add", employeePublicId: employeeId, role: "member", allocationPercent: 80,
        expectedProjectVersion: 3, expectedMembershipVersion: 0, reason: "加入交付小组",
      }),
      { params: Promise.resolve({ projectId }) },
      { session, rpc, createRequestId: () => requestId }, "POST",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "success", resource: "project_member", id: membershipId, version: 1,
      projectId, projectVersion: 4,
      member: { id: membershipId, employeePublicId: employeeId, role: "member",
        allocationPercent: 80, version: 1, leftAt: null },
    });
    expect(rpc).toHaveBeenCalledWith("mutate_current_project_member", expect.objectContaining({
      p_project_public_id: projectId, p_employee_public_id: employeeId,
      p_expected_project_version: 3, p_expected_membership_version: 0,
      idempotency_key: key, request_id: requestId,
    }));
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("tenantId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("organizationId");
  });

  it("fails closed before RPC for an unrelated or malformed member command", async () => {
    const rpc = vi.fn();
    const forbidden = await handleProjectMemberCommand(
      request(`https://workspace.test/api/workstation/projects/${projectId}/members`, "POST", {}),
      { params: Promise.resolve({ projectId }) },
      { session: { member: { status: "suspended" }, permissionCodes: [] }, rpc }, "POST",
    );
    expect(forbidden.status).toBe(403);
    const invalid = await handleProjectMemberCommand(
      request(`https://workspace.test/api/workstation/projects/${projectId}/members`, "POST", {
        command: "change_role", employeePublicId: employeeId, role: "owner", allocationPercent: 100,
        expectedProjectVersion: 3, expectedMembershipVersion: 1, reason: "绕过负责人转移",
      }),
      { params: Promise.resolve({ projectId }) }, { session, rpc }, "POST",
    );
    expect(invalid.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a stale membership CAS to conflict", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "failure", error: "stale_version" }, error: null });
    const response = await handleProjectMemberCommand(
      request(`https://workspace.test/api/workstation/projects/${projectId}/members`, "DELETE", {
        employeePublicId: employeeId, expectedProjectVersion: 4,
        expectedMembershipVersion: 2, reason: "成员离开交付范围",
      }),
      { params: Promise.resolve({ projectId }) }, { session, rpc }, "DELETE",
    );
    expect(response.status).toBe(409);
  });

  it("fails closed when a member success DTO drifts or coerces a null allocation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      outcome: "success", resource: "project_member", id: membershipId, version: 1,
      entity: { id: membershipId, projectId, employeePublicId: employeeId, role: "member",
        allocationPercent: null, version: 1, projectVersion: 4, leftAt: null },
    }, error: null });
    const command = {
      command: "add", employeePublicId: employeeId, role: "member", allocationPercent: 80,
      expectedProjectVersion: 3, expectedMembershipVersion: 0, reason: "加入交付小组",
    };
    const nullAllocation = await handleProjectMemberCommand(
      request(`https://workspace.test/api/workstation/projects/${projectId}/members`, "POST", command),
      { params: Promise.resolve({ projectId }) }, { session, rpc }, "POST",
    );
    expect(nullAllocation.status).toBe(503);

    rpc.mockResolvedValueOnce({ data: {
      outcome: "success", resource: "project_member", id: employeeId, version: 1,
      entity: { id: membershipId, projectId, employeePublicId: employeeId, role: "member",
        allocationPercent: 80, version: 1, projectVersion: 4, leftAt: null },
    }, error: null });
    const crossedId = await handleProjectMemberCommand(
      request(`https://workspace.test/api/workstation/projects/${projectId}/members`, "POST", command),
      { params: Promise.resolve({ projectId }) }, { session, rpc }, "POST",
    );
    expect(crossedId.status).toBe(503);
  });

  it("restores an archived project with an explicit legacy-safe status", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "success", resource: "project",
      entity: { id: projectId, version: 7, status: "on_hold" } }, error: null });
    const response = await handleProjectRestoreCommand(
      request(`https://workspace.test/api/workstation/projects/${projectId}/restore`, "POST", {
        expectedVersion: 6, restoreStatus: "on_hold", reason: "重新评估后恢复",
      }), { params: Promise.resolve({ projectId }) }, { session, rpc },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "success", id: projectId, version: 7, status: "on_hold" });
  });

  it("marks only the server-resolved recipient notification read", async () => {
    const readAt = "2026-08-28T12:00:00.000Z";
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "success", id: notificationId,
      state: "read", readAt, version: 3 }, error: null });
    const response = await handleNotificationReadCommand(
      request(`https://workspace.test/api/workstation/notifications/${notificationId}/read`, "POST", {}),
      { params: Promise.resolve({ notificationId }) }, { session, rpc },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "success", id: notificationId, state: "read", readAt, version: 3 });
    expect(rpc).toHaveBeenCalledWith("mark_current_notification_read", {
      p_notification_public_id: notificationId, p_request_id: key,
    });
  });
});

describe("project commercial completion migration", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/202608270011_project_commercial_completion.sql"), "utf8").toLowerCase();

  it("uses the strong actor/target/payload ledger for member, restore and retry commands", () => {
    expect(sql).toContain("'mutate_current_project_member'");
    expect(sql).toContain("'restore_current_project'");
    expect(sql).toContain("'retry_current_task_notification'");
    expect(sql).toContain("public.claim_project_execution_command");
    expect(sql).toContain("p_expected_membership_version");
    expect(sql).toContain("p_expected_project_version");
  });

  it("rejects unsafe owner or accountable-member removal", () => {
    expect(sql).toContain("v_target = v_project.owner_member_id");
    expect(sql).toContain("task.status in ('backlog','todo','in_progress','blocked','in_review')");
    expect(sql).toContain("milestone.status <> 'completed'");
    expect(sql).toContain("risk.status not in ('mitigated','closed')");
    expect(sql).toContain("attempt.state in ('claimed','provider_accepted')");
    expect(sql).toContain("last_error_code='recipient_read_only'");
  });

  it("persists append-only multi-round acceptance evidence", () => {
    expect(sql).toContain("create table public.task_acceptance_events");
    expect(sql).toContain("unique(task_id, task_version_after)");
    expect(sql).toContain("task acceptance history is append-only");
    expect(sql).toContain("create trigger capture_task_acceptance_event");
    expect(sql).toContain("actor_employee_public_id_snapshot uuid not null");
    expect(sql).toContain("actor_name_snapshot text not null");
  });

  it("supports controlled offboarding and safe historical membership reactivation", () => {
    expect(sql).toContain("p_command='remove' or (");
    expect(sql).toContain("p_expected_membership_version not in (0,v_membership.version)");
    expect(sql).toContain("profile.employment_status in ('probation','active','on_leave')");
    expect(sql).toContain("(v_actor=v_target and v_lock_count<>1)");
    expect(sql).toContain("(v_actor<>v_target and v_lock_count<>2)");
    expect(sql).not.toContain("v_lock_count <> case");
  });

  it("audits new command scope conflicts and closes legacy write entry points", () => {
    expect(sql.match(/public\.audit_project_execution_scope_conflict\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("revoke all on function public.archive_current_project(uuid,bigint,text,uuid,uuid)");
    expect(sql).toContain("revoke all on function public.create_current_project_task(uuid,text,text,bigint,date,text)");
    expect(sql).toContain("revoke all on function public.create_current_project_task_v2(uuid,text,text,bigint,date,text,text)");
    expect(sql).toContain("revoke all on function public.enqueue_task_assigned_notification()");
  });

  it("pairs archive and restore without inventing a legacy status", () => {
    expect(sql).toContain("add column archived_from_status text");
    expect(sql).toContain("new.archived_from_status := old.status");
    expect(sql).toContain("create or replace function public.restore_current_project");
    expect(sql).toContain("'restore_status_required'");
    expect(sql).not.toContain("update public.projects set archived_from_status = 'planning'");
  });

  it("separates delivery from recipient read and closes notification DML", () => {
    expect(sql).toContain("check (status in ('pending', 'sending', 'sent', 'failed'))");
    expect(sql).toContain("add column read_at timestamptz");
    expect(sql).toContain("add column next_retry_at timestamptz");
    expect(sql).toContain("case when notification.read_at is not null and notification.status='sent'");
    expect(sql).toContain("alter table public.task_notifications force row level security");
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger[\s\S]*task_notifications from public, anon, authenticated, service_role/);
  });

  it("requires an authorized retry and blocks archived-project delivery", () => {
    expect(sql).toContain("create or replace function public.retry_current_task_notification");
    expect(sql).toContain("notification.status<>'failed'");
    expect(sql).toContain("project.deleted_at is null and project.archived_at is null");
    expect(sql).toContain("'retry_required'");
    expect(sql).toContain("select project.* into v_project");
    expect(sql).toContain("select notification.* into strict v_notification");
    expect(sql).toContain("select task.* into v_task");
    expect(sql).toContain("select project.* into strict v_project");
    expect(sql).toContain("select tenant.* into strict v_tenant");
    expect(sql).toContain("select organization.* into strict v_organization");
    expect(sql).toContain("select project.name into strict v_project_name");
    expect(sql).not.toContain("select project,notification into v_project,v_notification");
    expect(sql).not.toContain("select task,project into v_task,v_project");
    expect(sql).not.toContain("select tenant,organization,task,project.name");
  });

  it("keeps task creation compatible only with an existing explicit contributor", () => {
    const guard = sql.slice(
      sql.indexOf("create or replace function public.enforce_explicit_project_member_lifecycle"),
      sql.indexOf("create trigger project_members_explicit_lifecycle_guard"),
    );
    expect(guard).toContain("tg_op='insert'");
    expect(guard).toContain("membership.role in ('owner','manager','member')");
    expect(guard).toContain("membership.left_at is null");
    expect(guard).toContain("return null");
    expect(guard).toContain("never create, revive or promote");
  });

  it("recovers an expired active attempt even after the fresh-attempt retry cap", () => {
    const recovery = sql.slice(
      sql.indexOf("create or replace function public.due_task_notifications_for_delivery"),
      sql.indexOf("create or replace function public.current_task_notification_inbox"),
    );
    expect(recovery).toContain("notification.status='pending' and notification.attempt_count<5");
    expect(recovery).toContain("notification.status='failed' and notification.attempt_count<5");
    expect(recovery).toContain("notification.status='sending' and exists");
    expect(recovery).not.toContain("where notification.attempt_count<5 and");
  });
});
