import { describe, expect, it, vi } from "vitest";

import {
  createWorkstationProjectCreateHandler,
  parseProjectCreate,
} from "@/app/api/workstation/projects/handler";

function request(body: unknown) {
  return new Request("https://workspace.test/api/workstation/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("formal workstation project create", () => {
  it("parses valid project input", () => {
    expect(parseProjectCreate({
      name: "AI商业矩阵",
      ownerMemberId: "m3",
      category: "AI研发",
      description: "形成商业矩阵",
      startDate: "2026-08-24",
      dueDate: "2026-08-28",
      budgetWan: "30",
    })).toMatchObject({
      name: "AI商业矩阵",
      ownerMemberId: 3,
      category: "AI研发",
      startDate: "2026-08-24",
      dueDate: "2026-08-28",
      budgetWan: 30,
    });
  });

  it("rejects project creation without project management permission", async () => {
    const createProject = vi.fn();
    const handler = createWorkstationProjectCreateHandler({
      loadSession: vi.fn().mockResolvedValue({
        organization: { id: "1" },
        member: { id: 3 },
        permissionCodes: ["task.manage"],
      }),
      createProject,
    });

    const response = await handler(request({
      name: "AI商业矩阵",
      ownerMemberId: "m3",
      startDate: "2026-08-24",
      dueDate: "2026-08-28",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(createProject).not.toHaveBeenCalled();
  });

  it("allows organization managers to create projects", async () => {
    const project = { id: "project-public-id", n: "AI鍟嗕笟鐭╅樀" };
    const createProject = vi.fn().mockResolvedValue(project);
    const handler = createWorkstationProjectCreateHandler({
      loadSession: vi.fn().mockResolvedValue({
        organization: { id: "7" },
        member: { id: 3 },
        permissionCodes: ["organization.manage"],
      }),
      createProject,
    });

    const response = await handler(request({
      name: "AI鍟嗕笟鐭╅樀",
      ownerMemberId: "m4",
      startDate: "2026-08-24",
      dueDate: "2026-08-28",
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ project });
    expect(createProject).toHaveBeenCalled();
  });

  it("creates a project using the current organization and actor", async () => {
    const project = { id: "project-public-id", n: "AI商业矩阵" };
    const createProject = vi.fn().mockResolvedValue(project);
    const handler = createWorkstationProjectCreateHandler({
      loadSession: vi.fn().mockResolvedValue({
        organization: { id: "7" },
        member: { id: 3 },
        permissionCodes: ["project.manage"],
      }),
      createProject,
    });

    const response = await handler(request({
      name: "AI商业矩阵",
      ownerMemberId: "m4",
      category: "AI研发",
      description: "形成商业矩阵",
      startDate: "2026-08-24",
      dueDate: "2026-08-28",
      budgetWan: 10,
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ project });
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      actorMemberId: 3,
      organizationId: "7",
      ownerMemberId: 4,
      name: "AI商业矩阵",
    }));
  });
});
