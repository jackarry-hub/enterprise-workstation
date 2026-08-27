import { describe, expect, it, vi } from "vitest";

import {
  ManagerScopeStoreError,
  createManagerScopeHandlers,
} from "@/features/organization/manager-scope-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const directReportId = "73000000-0000-4000-8000-000000000001";
const managerId = "73000000-0000-4000-8000-000000000002";
const otherDepartmentId = "73000000-0000-4000-8000-000000000003";
const idempotencyKey = "73000000-0000-4000-8000-000000000010";
const requestId = "73000000-0000-4000-8000-000000000011";

const supervisorSession = {
  ...executiveWorkspaceSession,
  roleCodes: ["supervisor" as const],
  permissionCodes: ["employee.supervisor.read" as const],
  supervisorScopeEmployeeIds: [directReportId],
  primaryRole: "employee" as const,
  landingPath: "/execution",
  actor: {
    ...executiveWorkspaceSession.actor,
    role: "employee" as const,
    roleLabel: "主管",
    landingPath: "/execution",
  },
};

const managerSession = {
  ...executiveWorkspaceSession,
  permissionCodes: ["organization.manage" as const],
  supervisorScopeEmployeeIds: [],
};

function context(memberId: string) {
  return { params: Promise.resolve({ memberId }) };
}

function writeRequest(body: unknown, key: string | null = idempotencyKey) {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) headers.set("Idempotency-Key", key);
  return new Request(`https://workspace.test/api/workstation/organization/members/${directReportId}/manager`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("manager scope handler", () => {
  it("fails closed for unauthenticated, malformed, and out-of-scope reads", async () => {
    const rpc = vi.fn();
    const unauthenticated = createManagerScopeHandlers({ session: null, rpc });
    const supervisor = createManagerScopeHandlers({ session: supervisorSession, rpc });

    expect((await unauthenticated.GET(new Request("https://workspace.test"), context(directReportId))).status).toBe(401);
    expect((await supervisor.GET(new Request("https://workspace.test"), context("not-a-uuid"))).status).toBe(400);
    const hidden = await supervisor.GET(new Request("https://workspace.test"), context(otherDepartmentId));
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads a protected direct report through the independently scoped database RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        employee_public_id: directReportId,
        display_name: "陈工",
        department_name: "工程部",
        job_title: "后端工程师",
        manager_employee_public_id: managerId,
        manager_version: 4,
        manager_source: "directory",
      }],
      error: null,
    });
    const handlers = createManagerScopeHandlers({ session: supervisorSession, rpc });

    const response = await handlers.GET(new Request("https://workspace.test"), context(directReportId));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      employeeId: directReportId,
      displayName: "陈工",
      departmentName: "工程部",
      jobTitle: "后端工程师",
      managerEmployeeId: managerId,
      managerVersion: 4,
      managerSource: "directory",
    });
    expect(rpc).toHaveBeenCalledWith("current_supervisor_employee_projection", {
      p_employee_public_id: directReportId,
    });
  });

  it("returns 404 for an empty protected projection and 503 for a store failure", async () => {
    const empty = createManagerScopeHandlers({
      session: supervisorSession,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    const unavailable = createManagerScopeHandlers({
      session: supervisorSession,
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "08006" } }),
    });

    expect((await empty.GET(new Request("https://workspace.test"), context(directReportId))).status).toBe(404);
    const response = await unavailable.GET(new Request("https://workspace.test"), context(directReportId));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "manager_scope_unavailable" });
  });

  it("validates the manager command before invoking the database", async () => {
    const rpc = vi.fn();
    const handlers = createManagerScopeHandlers({ session: managerSession, rpc });
    const cases = [
      writeRequest({ managerEmployeeId: managerId, expectedVersion: 4, reason: "组织调整" }, null),
      writeRequest({ managerEmployeeId: "not-a-uuid", expectedVersion: 4, reason: "组织调整" }),
      writeRequest({ managerEmployeeId: managerId, expectedVersion: 0, reason: "组织调整" }),
      writeRequest({ managerEmployeeId: managerId, expectedVersion: 4, reason: "" }),
    ];

    for (const request of cases) {
      expect((await handlers.POST(request, context(directReportId))).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires organization.manage before assigning a manager", async () => {
    const rpc = vi.fn();
    const handlers = createManagerScopeHandlers({ session: supervisorSession, rpc });
    const response = await handlers.POST(
      writeRequest({ managerEmployeeId: managerId, expectedVersion: 4, reason: "组织调整" }),
      context(directReportId),
    );

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends exact public IDs, version, reason, and separate request/idempotency IDs", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "success", id: directReportId, version: 5 },
      error: null,
    });
    const handlers = createManagerScopeHandlers({
      session: managerSession,
      rpc,
      createRequestId: () => requestId,
    });

    const response = await handlers.POST(
      writeRequest({ managerEmployeeId: managerId, expectedVersion: 4, reason: "明确新的汇报关系" }),
      context(directReportId),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "success", id: directReportId, version: 5 });
    expect(rpc).toHaveBeenCalledWith("assign_current_member_manager", {
      p_target_employee_public_id: directReportId,
      p_manager_employee_public_id: managerId,
      p_expected_manager_version: 4,
      p_reason: "明确新的汇报关系",
      request_id: requestId,
      idempotency_key: idempotencyKey,
    });
  });

  it.each([
    ["forbidden", 403],
    ["not_found", 404],
    ["stale_version", 409],
    ["manager_cycle", 409],
    ["directory_manager_owned", 409],
    ["invalid_manager", 400],
  ] as const)("maps stable database outcome %s without leaking target details", async (error, status) => {
    const handlers = createManagerScopeHandlers({
      session: managerSession,
      rpc: vi.fn().mockResolvedValue({ data: { outcome: "failure", error }, error: null }),
    });
    const response = await handlers.POST(
      writeRequest({ managerEmployeeId: managerId, expectedVersion: 4, reason: "组织调整" }),
      context(directReportId),
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("maps an unexpected database error to an explicit unavailable response", async () => {
    const handlers = createManagerScopeHandlers({
      session: managerSession,
      rpc: vi.fn().mockRejectedValue(new ManagerScopeStoreError("08006")),
    });
    const response = await handlers.POST(
      writeRequest({ managerEmployeeId: managerId, expectedVersion: 4, reason: "组织调整" }),
      context(directReportId),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "manager_scope_unavailable" });
  });
});
