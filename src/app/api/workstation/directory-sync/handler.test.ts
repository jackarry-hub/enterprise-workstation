import { describe, expect, it, vi } from "vitest";

import { createDirectorySyncHandler } from "@/app/api/workstation/directory-sync/handler";

const snapshot = { departments: [], positions: [], employees: [], complete: true as const };

describe("workstation directory sync route", () => {
  it("requires a Feishu workspace session", async () => {
    const response = await createDirectorySyncHandler({
      loadSession: async () => null,
      loadSnapshot: async () => snapshot,
      applySnapshot: async () => ({}),
    })();
    expect(response.status).toBe(401);
  });

  it("allows only owners or administrators", async () => {
    const response = await createDirectorySyncHandler({
      loadSession: async () => ({ roleCodes: ["employee"] }),
      loadSnapshot: async () => snapshot,
      applySnapshot: async () => ({}),
    })();
    expect(response.status).toBe(403);
  });

  it("syncs the Feishu snapshot using the authenticated owner identity", async () => {
    const applySnapshot = vi.fn(async () => ({
      status: "completed",
      employeeCount: 2,
      insertedCount: 1,
      updatedCount: 1,
      deactivatedCount: 0,
    }));
    const session = {
      tenantId: "10000000-0000-4000-8000-000000000001",
      authUserId: "10000000-0000-4000-8000-000000000002",
      roleCodes: ["owner"],
    };
    const response = await createDirectorySyncHandler({
      loadSession: async () => session,
      loadSnapshot: async () => snapshot,
      applySnapshot,
    })();

    expect(response.status).toBe(200);
    expect(applySnapshot).toHaveBeenCalledWith(session, snapshot);
    await expect(response.json()).resolves.toMatchObject({
      status: "completed",
      employeeCount: 2,
    });
  });
});
