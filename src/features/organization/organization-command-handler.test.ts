import { describe, expect, it, vi } from "vitest";

import {
  OrganizationCommandStoreError,
  handleOrganizationCommand,
} from "@/features/organization/organization-command-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const idempotencyKey = "70000000-0000-4000-8000-000000000001";
const adminSession = {
  ...executiveWorkspaceSession,
  permissionCodes: ["organization.manage" as const, "role.manage" as const],
};
const employeeSession = {
  ...executiveWorkspaceSession,
  permissionCodes: ["task.execute" as const],
  roleCodes: ["employee" as const],
  primaryRole: "employee" as const,
  landingPath: "/execution",
  actor: { ...executiveWorkspaceSession.actor, role: "employee" as const },
};

function request(body: unknown) {
  return new Request("https://workspace.test/api/workstation/organization", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

describe("organization command handler", () => {
  it("denies an employee before invoking a department command", async () => {
    const rpc = vi.fn();
    const response = await handleOrganizationCommand(
      request({ type: "create_department", code: "OPS", name: "Operations" }),
      { session: employeeSession, rpc },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends a validated admin department command with a server request id", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: "70000000-0000-4000-8000-000000000002", version: 1 },
      error: null,
    });
    const response = await handleOrganizationCommand(
      request({
        type: "create_department",
        code: "OPS",
        name: "Operations",
        description: "QuantXY owned description",
        sortOrder: 3,
      }),
      { session: adminSession, rpc },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: "70000000-0000-4000-8000-000000000002",
      version: 1,
    });
    expect(rpc).toHaveBeenCalledWith("create_current_department", expect.objectContaining({
      request_id: idempotencyKey,
      p_code: "OPS",
      p_name: "Operations",
    }));
  });

  it("rejects Feishu-owned source fields without invoking the RPC", async () => {
    const rpc = vi.fn();
    const response = await handleOrganizationCommand(
      request({
        type: "upsert_position",
        code: "OPS-01",
        name: "Operations Specialist",
        category: "Operations",
        source: "feishu",
      }),
      { session: adminSession, rpc },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "feishu_owned_field" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires role.manage for role changes and maps stale versions to a stable conflict", async () => {
    const deniedRpc = vi.fn();
    const denied = await handleOrganizationCommand(
      request({ type: "assign_member_role", memberId: 11, roleCode: "hr", version: 2 }),
      { session: { ...adminSession, permissionCodes: ["organization.manage" as const] }, rpc: deniedRpc },
    );
    const conflict = await handleOrganizationCommand(
      request({ type: "assign_member_role", memberId: 11, roleCode: "hr", version: 2 }),
      {
        session: adminSession,
        rpc: vi.fn().mockRejectedValue(new OrganizationCommandStoreError("40001")),
      },
    );

    expect(denied.status).toBe(403);
    expect(deniedRpc).not.toHaveBeenCalled();
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "stale_version" });
  });
});
