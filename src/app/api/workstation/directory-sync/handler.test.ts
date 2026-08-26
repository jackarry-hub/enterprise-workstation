import { describe, expect, it, vi } from "vitest";

import { createDirectorySyncHandler } from "@/app/api/workstation/directory-sync/handler";
import { loadFeishuDirectorySnapshot } from "@/features/feishu/directory-sync";

const snapshot = { departments: [], positions: [], employees: [], complete: true as const };
const unusedResult = {
  runId: "31000000-0000-4000-8000-000000000000",
  status: "completed" as const,
  departmentCount: 0,
  employeeCount: 0,
  issueCount: 0,
};

describe("workstation directory sync route", () => {
  it("requires a Feishu workspace session", async () => {
    const response = await createDirectorySyncHandler({
      loadSession: async () => null,
      loadSnapshot: async () => snapshot,
      applySnapshot: async () => unusedResult,
    })();
    expect(response.status).toBe(401);
  });

  it("denies a fake admin role without the directory-management permission", async () => {
    const response = await createDirectorySyncHandler({
      loadSession: async () => ({ roleCodes: ["admin"], permissionCodes: [] }),
      loadSnapshot: async () => snapshot,
      applySnapshot: async () => unusedResult,
    })();
    expect(response.status).toBe(403);
  });

  it("syncs the Feishu snapshot with explicit directory-management permission", async () => {
    const result = {
      runId: "31000000-0000-4000-8000-000000000001",
      status: "completed",
      departmentCount: 1,
      employeeCount: 2,
      issueCount: 0,
    } as const;
    const applySnapshot = vi.fn(async () => result);
    const session = {
      tenantId: "10000000-0000-4000-8000-000000000001",
      authUserId: "10000000-0000-4000-8000-000000000002",
      roleCodes: ["employee"],
      permissionCodes: ["organization.manage"] as const,
    };
    const response = await createDirectorySyncHandler({
      loadSession: async () => session,
      loadSnapshot: async () => snapshot,
      applySnapshot,
      createRequestId: () => "30000000-0000-4000-8000-000000000001",
      recordFailure: async () => ({
        runId: "31000000-0000-4000-8000-000000000002",
        status: "failed",
        departmentCount: 0,
        employeeCount: 0,
        issueCount: 1,
      }),
    })();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("30000000-0000-4000-8000-000000000001");
    expect(applySnapshot).toHaveBeenCalledWith(
      session,
      snapshot,
      "30000000-0000-4000-8000-000000000001",
    );
    await expect(response.json()).resolves.toEqual(result);
  });

  it("records a safe failed run with the request ID and never applies a partial snapshot", async () => {
    const applySnapshot = vi.fn(async () => unusedResult);
    const recordFailure = vi.fn(async () => ({
      runId: "31000000-0000-4000-8000-000000000003",
      status: "failed" as const,
      departmentCount: 0,
      employeeCount: 0,
      issueCount: 1,
    }));
    const session = {
      tenantId: "10000000-0000-4000-8000-000000000001",
      authUserId: "10000000-0000-4000-8000-000000000002",
      roleCodes: ["owner"],
      permissionCodes: ["organization.manage"] as const,
    };

    const response = await createDirectorySyncHandler({
      loadSession: async () => session,
      loadSnapshot: async () => {
        throw Object.assign(new Error("provider secret must not escape"), {
          code: "directory_pagination_limit",
        });
      },
      applySnapshot,
      recordFailure,
      createRequestId: () => "30000000-0000-4000-8000-000000000002",
    })();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("30000000-0000-4000-8000-000000000002");
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(
      session,
      "directory_pagination_limit",
      "30000000-0000-4000-8000-000000000002",
    );
    expect(body).toEqual({
      error: {
        code: "directory_pagination_limit",
        requestId: "30000000-0000-4000-8000-000000000002",
        runId: "31000000-0000-4000-8000-000000000003",
      },
    });
    expect(JSON.stringify(body)).not.toContain("provider secret");
  });

  it("returns the same stable failure when durable failure recording also fails", async () => {
    const logFailure = vi.fn();
    const session = {
      tenantId: "10000000-0000-4000-8000-000000000001",
      authUserId: "10000000-0000-4000-8000-000000000002",
      roleCodes: ["owner"],
      permissionCodes: ["organization.manage"] as const,
    };
    const response = await createDirectorySyncHandler({
      loadSession: async () => session,
      loadSnapshot: async () => { throw new Error("database detail"); },
      applySnapshot: async () => unusedResult,
      recordFailure: async () => { throw new Error("recording database detail"); },
      createRequestId: () => "30000000-0000-4000-8000-000000000004",
      logFailure,
    })();

    expect(response.status).toBe(502);
    expect(response.headers.get("x-request-id")).toBe("30000000-0000-4000-8000-000000000004");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "directory_unexpected",
        requestId: "30000000-0000-4000-8000-000000000004",
      },
    });
    expect(logFailure).toHaveBeenCalledWith({
      event: "directory_sync_failed",
      code: "directory_unexpected",
      requestId: "30000000-0000-4000-8000-000000000004",
    });
  });

  it("records an apply transaction failure without exposing database details", async () => {
    const session = {
      tenantId: "10000000-0000-4000-8000-000000000001",
      authUserId: "10000000-0000-4000-8000-000000000002",
      roleCodes: ["owner"],
      permissionCodes: ["organization.manage"] as const,
    };
    const recordFailure = vi.fn(async () => ({
      runId: "31000000-0000-4000-8000-000000000005",
      status: "failed" as const,
      departmentCount: 0,
      employeeCount: 0,
      issueCount: 1,
    }));
    const response = await createDirectorySyncHandler({
      loadSession: async () => session,
      loadSnapshot: async () => snapshot,
      applySnapshot: async () => {
        throw new Error("relation and credential details");
      },
      recordFailure,
      createRequestId: () => "30000000-0000-4000-8000-000000000005",
      logFailure: () => {
        throw new Error("logging sink unavailable");
      },
    })();

    expect(recordFailure).toHaveBeenCalledWith(
      session,
      "directory_apply_failed",
      "30000000-0000-4000-8000-000000000005",
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("x-request-id")).toBe("30000000-0000-4000-8000-000000000005");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "directory_apply_failed",
        requestId: "30000000-0000-4000-8000-000000000005",
        runId: "31000000-0000-4000-8000-000000000005",
      },
    });
  });

  it("recovers a committed run when the apply RPC response is lost", async () => {
    const session = {
      tenantId: "10000000-0000-4000-8000-000000000001",
      authUserId: "10000000-0000-4000-8000-000000000002",
      roleCodes: ["owner"],
      permissionCodes: ["organization.manage"] as const,
    };
    const committed = {
      runId: "31000000-0000-4000-8000-000000000006",
      status: "completed" as const,
      departmentCount: 4,
      employeeCount: 28,
      issueCount: 0,
    };
    const recordFailure = vi.fn(async () => committed);
    const response = await createDirectorySyncHandler({
      loadSession: async () => session,
      loadSnapshot: async () => snapshot,
      applySnapshot: async () => {
        throw new Error("transport closed after database commit");
      },
      recordFailure,
      createRequestId: () => "30000000-0000-4000-8000-000000000006",
    })();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("30000000-0000-4000-8000-000000000006");
    expect(recordFailure).toHaveBeenCalledWith(
      session,
      "directory_apply_failed",
      "30000000-0000-4000-8000-000000000006",
    );
    await expect(response.json()).resolves.toEqual(committed);
  });

  it("records a malformed lifecycle payload without applying or leaking provider data", async () => {
    const session = {
      tenantId: "10000000-0000-4000-8000-000000000001",
      authUserId: "10000000-0000-4000-8000-000000000002",
      roleCodes: ["owner"],
      permissionCodes: ["organization.manage"] as const,
    };
    const applySnapshot = vi.fn(async () => unusedResult);
    const recordFailure = vi.fn(async () => ({
      runId: "31000000-0000-4000-8000-000000000007",
      status: "failed" as const,
      departmentCount: 0,
      employeeCount: 0,
      issueCount: 1,
    }));
    const response = await createDirectorySyncHandler({
      loadSession: async () => session,
      loadSnapshot: () => loadFeishuDirectorySnapshot(
        { appId: "cli_test", appSecret: "provider-secret" },
        async (input) => {
          const url = String(input);
          if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
            return Response.json({ code: 0, tenant_access_token: "tenant-secret" });
          }
          if (url.includes("/departments/0/children")) {
            return Response.json({ code: 0, data: { has_more: false, items: [] } });
          }
          return Response.json({
            code: 0,
            data: {
              has_more: false,
              items: [{ open_id: "ou-user", name: "员工", status: "raw-invalid-status" }],
            },
          });
        },
      ),
      applySnapshot,
      recordFailure,
      createRequestId: () => "30000000-0000-4000-8000-000000000007",
    })();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(response.headers.get("x-request-id")).toBe("30000000-0000-4000-8000-000000000007");
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(
      session,
      "directory_payload_invalid",
      "30000000-0000-4000-8000-000000000007",
    );
    expect(body).toEqual({
      error: {
        code: "directory_payload_invalid",
        requestId: "30000000-0000-4000-8000-000000000007",
        runId: "31000000-0000-4000-8000-000000000007",
      },
    });
    expect(JSON.stringify(body)).not.toContain("raw-invalid-status");
    expect(JSON.stringify(body)).not.toContain("provider-secret");
  });
});
