import { describe, expect, it, vi } from "vitest";

import { createDataImportBootstrapHandler } from "@/app/api/workstation/data-imports/handler";
import { parseDataImportBootstrap } from "@/features/settings/data-import-types";

const projectId = "11111111-1111-4111-8111-111111111111";
const hiddenProjectId = "22222222-2222-4222-8222-222222222222";

describe("data import bootstrap", () => {
  it("rejects unauthenticated access before loading project data", async () => {
    const loadProjects = vi.fn();
    const response = await createDataImportBootstrapHandler({
      loadSession: async () => null,
      loadProjects,
    })();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(loadProjects).not.toHaveBeenCalled();
  });

  it("returns only real, writable projects and derives every action from permissions", async () => {
    const response = await createDataImportBootstrapHandler({
      loadSession: async () => ({
        organization: { name: "量子星河" },
        permissionCodes: [
          "organization.manage", "customer.import", "customer.export",
          "customer.export_pii", "project.files", "knowledge.manage",
        ],
        isAdmin: false,
      }),
      loadProjects: async () => ({
        source: "supabase",
        projects: [
          { id: projectId, code: "QXY-001", name: "企业工作站", viewerRole: "member" },
          { id: hiddenProjectId, code: "QXY-002", name: "不可写项目", viewerRole: "viewer" },
        ],
      }),
    })();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      source: "supabase",
      organizationName: "量子星河",
      capabilities: {
        directorySync: true,
        customerImport: true,
        customerExport: true,
        customerExportPii: true,
        projectFileUpload: true,
        knowledgeManage: true,
      },
      projects: [{ id: projectId, code: "QXY-001", name: "企业工作站" }],
      projectDataStatus: "ready",
    });
    expect(parseDataImportBootstrap(payload)).toEqual(payload);
  });

  it("keeps independent imports available when the project list is temporarily unavailable", async () => {
    const response = await createDataImportBootstrapHandler({
      loadSession: async () => ({
        organization: { name: "量子星河" },
        permissionCodes: ["organization.manage", "customer.import", "project.files"],
        isAdmin: true,
      }),
      loadProjects: async () => {
        throw new Error("database detail must not escape");
      },
    })();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: "supabase",
      capabilities: { directorySync: true, customerImport: true, projectFileUpload: true },
      projects: [],
      projectDataStatus: "unavailable",
    });
  });

  it("never accepts a mock project source", async () => {
    const response = await createDataImportBootstrapHandler({
      loadSession: async () => ({
        organization: { name: "量子星河" },
        permissionCodes: ["project.files"],
        isAdmin: true,
      }),
      loadProjects: async () => ({
        source: "mock",
        projects: [{ id: projectId, code: "DEMO", name: "演示项目", viewerRole: "owner" }],
      }),
    })();

    await expect(response.json()).resolves.toMatchObject({
      source: "supabase",
      projects: [],
      projectDataStatus: "unavailable",
    });
  });
});
