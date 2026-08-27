import { describe, expect, it, vi } from "vitest";

import {
  createWorkstationProjectCreateHandler,
  parseProjectCreate,
} from "@/app/api/workstation/projects/handler";

const ownerPublicId = "81000000-0000-4000-8000-000000000001";
const idempotencyKey = "81000000-0000-4000-8000-000000000002";

function rpcProject(id: string) {
  return {
    outcome: "success",
    id,
    version: 1,
    project: {
      id,
      version: 1,
      name: "AI商业矩阵",
      ownerPublicId,
      category: "AI研发",
      budgetAmount: "0.00",
      status: "planning",
      priority: "medium",
      health: "on_track",
      progress: 0,
      startsOn: "2026-08-24",
      dueOn: "2026-08-28",
      updatedAt: "2026-08-24T08:00:00.000Z",
    },
  };
}

function request(body: unknown) {
  return new Request("https://workspace.test/api/workstation/projects", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

describe("formal workstation project create", () => {
  it("parses valid project input", () => {
    expect(parseProjectCreate({
      name: "AI商业矩阵",
      ownerPublicId,
      category: "AI研发",
      description: "形成商业矩阵",
      startDate: "2026-08-24",
      dueDate: "2026-08-28",
      budgetAmount: "300000.50",
      version: 0,
    })).toMatchObject({
      name: "AI商业矩阵",
      ownerPublicId,
      category: "AI研发",
      startsOn: "2026-08-24",
      dueOn: "2026-08-28",
      budgetAmount: "300000.50",
      version: 0,
    });
  });

  it("rejects malformed money instead of coercing it to zero", () => {
    expect(parseProjectCreate({
      name: "AI商业矩阵",
      ownerPublicId,
      startsOn: "2026-08-24",
      dueOn: "2026-08-28",
      budgetAmount: "abc",
      version: 0,
    })).toBeNull();
  });

  it("rejects array-backed enum values instead of coercing them", () => {
    expect(parseProjectCreate({
      name: "AI商业矩阵", ownerPublicId, startsOn: "2026-08-24", dueOn: "2026-08-28",
      budgetAmount: "0.00", version: 0, priority: ["medium"], status: ["planning"],
    })).toBeNull();
  });

  it("rejects project creation without project management permission", async () => {
    const createProject = vi.fn();
    const handler = createWorkstationProjectCreateHandler({
      loadSession: vi.fn().mockResolvedValue({
        organization: { id: "1" },
        member: { id: 3, status: "active" },
        permissionCodes: ["task.manage"],
      }),
      createProject,
    });

    const response = await handler(request({
      name: "AI商业矩阵",
      ownerPublicId,
      startDate: "2026-08-24",
      dueDate: "2026-08-28",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(createProject).not.toHaveBeenCalled();
  });

  it("allows organization managers to create projects", async () => {
    const project = rpcProject("81000000-0000-4000-8000-000000000005");
    const createProject = vi.fn().mockResolvedValue(project);
    const handler = createWorkstationProjectCreateHandler({
      loadSession: vi.fn().mockResolvedValue({
        organization: { id: "7" },
        member: { id: 3, status: "active" },
        permissionCodes: ["organization.manage"],
      }),
      createProject,
    });

    const response = await handler(request({
      name: "AI鍟嗕笟鐭╅樀",
      ownerPublicId,
      startsOn: "2026-08-24",
      dueOn: "2026-08-28",
      budgetAmount: "0.00",
      version: 0,
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ project: project.project });
    expect(createProject).toHaveBeenCalled();
  });

  it("creates a project using the current organization and actor", async () => {
    const project = rpcProject("81000000-0000-4000-8000-000000000006");
    const createProject = vi.fn().mockResolvedValue(project);
    const handler = createWorkstationProjectCreateHandler({
      loadSession: vi.fn().mockResolvedValue({
        organization: { id: "7" },
        member: { id: 3, status: "active" },
        permissionCodes: ["project.manage"],
      }),
      createProject,
    });

    const response = await handler(request({
      name: "AI商业矩阵",
      ownerPublicId,
      category: "AI研发",
      description: "形成商业矩阵",
      startDate: "2026-08-24",
      dueDate: "2026-08-28",
      budgetAmount: "100000.00",
      version: 0,
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ project: project.project });
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      ownerPublicId,
      name: "AI商业矩阵",
      budgetAmount: "100000.00",
      idempotencyKey,
    }));
  });

  it("requires a UUID idempotency key before invoking the command", async () => {
    const createProject = vi.fn();
    const handler = createWorkstationProjectCreateHandler({
      loadSession: vi.fn().mockResolvedValue({
        organization: { id: "81000000-0000-4000-8000-000000000003" },
        member: { id: 3, status: "active" },
        permissionCodes: ["project.manage"],
      }),
      createProject,
    });
    const invalid = new Request("https://workspace.test/api/workstation/projects", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "bad" },
      body: JSON.stringify({
        name: "AI商业矩阵", ownerPublicId, startDate: "2026-08-24",
        dueDate: "2026-08-28", budgetAmount: "0.00", version: 0,
      }),
    });

    const response = await handler(invalid);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_idempotency_key" });
    expect(createProject).not.toHaveBeenCalled();
  });

  it("does not expose unrecognized database failure text", async () => {
    const handler = createWorkstationProjectCreateHandler({
      loadSession: vi.fn().mockResolvedValue({
        member: { status: "active" }, permissionCodes: ["project.manage"],
      }),
      createProject: vi.fn().mockResolvedValue({
        outcome: "failure", error: "relation internal_projects leaked detail",
      }),
    });

    const response = await handler(request({
      name: "AI商业矩阵", ownerPublicId, startsOn: "2026-08-24", dueOn: "2026-08-28",
      budgetAmount: "0.00", version: 0,
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "project_command_unavailable" });
  });
});
