import { describe, expect, it } from "vitest";

import {
  clearLocalProjects,
  createLocalProject,
  getProjectsStorageKey,
  readLocalProjects,
  saveLocalProject,
} from "@/features/projects/data/mock-project-repository";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { getProjectDetailMock, mockMembers, mockProjects } from "@/features/projects/mock-data";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const context = createOperationFixtureContext(executiveWorkspaceSession);

function createMemoryStorage(initialValue?: string) {
  const values = new Map<string, string>();

  if (initialValue !== undefined) {
    values.set(getProjectsStorageKey(context)!, initialValue);
  }

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("mock project repository", () => {
  it("creates and persists a complete project aggregate", () => {
    const storage = createMemoryStorage();
    const ids = ["project-local-1", "owner-membership-1", "member-membership-1"];

    const detail = createLocalProject(context, {
      name: "客户门户二期",
      description: "完善客户自助服务与交付进度查询。",
      ownerId: mockMembers[0].id,
      memberIds: [mockMembers[0].id, mockMembers[3].id],
      startDate: "2026-08-10",
      dueDate: "2026-10-30",
      priority: "high",
      status: "planning",
    }, executiveWorkspaceSession.actor, {
      storage,
      now: () => new Date("2026-08-05T02:00:00.000Z"),
      createId: () => ids.shift() ?? "extra-id",
    });

    expect(detail.project).toMatchObject({
      id: "project-local-1",
      code: "PRJ-2026-025",
      name: "客户门户二期",
      progress: 0,
      health: "on_track",
    });
    expect(detail.members.map(({ role }) => role)).toEqual(["owner", "member"]);
    expect(detail.members.map(({ member }) => member.id)).toEqual([
      mockMembers[0].id,
      mockMembers[3].id,
    ]);
    expect(detail.tasks).toEqual([]);
    expect(detail.milestones).toEqual([]);
    expect(readLocalProjects(context, { storage })).toEqual([detail]);
  });

  it("deduplicates the owner and advances project codes across local records", () => {
    const storage = createMemoryStorage();
    const ids = [
      "project-local-1",
      "membership-local-1",
      "project-local-2",
      "membership-local-2",
    ];
    const options = {
      storage,
      now: () => new Date("2026-08-05T02:00:00.000Z"),
      createId: () => ids.shift() ?? "extra-id",
    };

    createLocalProject(context, {
      name: "项目甲",
      description: "第一个本地项目",
      ownerId: mockMembers[0].id,
      memberIds: [mockMembers[0].id, mockMembers[0].id],
      startDate: "2026-08-10",
      dueDate: "2026-09-10",
      priority: "medium",
      status: "planning",
    }, executiveWorkspaceSession.actor, options);
    const second = createLocalProject(context, {
      name: "项目乙",
      description: "第二个本地项目",
      ownerId: mockMembers[1].id,
      memberIds: [],
      startDate: "2026-08-12",
      dueDate: "2026-09-20",
      priority: "high",
      status: "active",
    }, executiveWorkspaceSession.actor, options);

    expect(second.project.code).toBe("PRJ-2026-026");
    expect(readLocalProjects(context, { storage })[0].members).toHaveLength(1);
  });

  it("treats corrupt browser storage as an empty local portfolio", () => {
    const storage = createMemoryStorage("{broken-json");

    expect(readLocalProjects(context, { storage })).toEqual([]);
  });

  it("replaces a matching local project and can clear the store", () => {
    const storage = createMemoryStorage();
    const detail = structuredClone(getProjectDetailMock(mockProjects[0].id));

    expect(detail).toBeDefined();
    if (!detail) {
      return;
    }

    saveLocalProject(context, detail, { storage });
    const updated = {
      ...detail,
      project: { ...detail.project, progress: 88 },
    };
    saveLocalProject(context, updated, { storage });

    expect(readLocalProjects(context, { storage })).toHaveLength(1);
    expect(readLocalProjects(context, { storage })[0].project.progress).toBe(88);

    clearLocalProjects(context, { storage });
    expect(readLocalProjects(context, { storage })).toEqual([]);
  });

  it("does not report a successful write when storage rejects it", () => {
    const detail = getProjectDetailMock(mockProjects[0].id);
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => undefined,
    };

    expect(() => saveLocalProject(context, detail!, { storage })).toThrow("quota exceeded");
  });
});
