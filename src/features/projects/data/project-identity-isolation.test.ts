import { describe, expect, it, vi } from "vitest";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import {
  createLocalProject,
  getProjectsStorageKey,
  readLocalProjects,
  saveLocalProject,
} from "@/features/projects/data/mock-project-repository";
import { getProjectDetailMock, mockMembers, mockProjects } from "@/features/projects/mock-data";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

function unboundSession(overrides: Partial<WorkspaceSession> = {}): WorkspaceSession {
  const authUserId = overrides.authUserId ?? "10000000-0000-4000-8000-000000000099";
  const member = overrides.member ?? { ...executiveWorkspaceSession.member, id: 99 };
  return {
    ...executiveWorkspaceSession,
    ...overrides,
    authUserId,
    member,
    actor: {
      ...executiveWorkspaceSession.actor,
      id: authUserId,
      memberId: String(member.id),
      ...overrides.actor,
    },
  };
}

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

const boundContext = createOperationFixtureContext(executiveWorkspaceSession);

describe("project repository identity isolation", () => {
  it("stores bound project state under the tenant, auth user, and member namespace", () => {
    const browserStorage = storage();
    const detail = getProjectDetailMock(mockProjects[0].id)!;

    saveLocalProject(boundContext, detail, { storage: browserStorage });

    expect(getProjectsStorageKey(boundContext)).toBe(
      "enterprise-workspace.projects.v1:10000000-0000-4000-8000-000000000000:10000000-0000-4000-8000-000000000001:10",
    );
    expect(browserStorage.setItem).toHaveBeenCalledWith(
      getProjectsStorageKey(boundContext),
      expect.stringContaining(detail.project.id),
    );
    expect(browserStorage.getItem).not.toHaveBeenCalledWith("enterprise-workspace.projects.v1");
  });

  it.each([
    ["same role, different user", unboundSession()],
    ["same role, different tenant", unboundSession({ tenantId: "10000000-0000-4000-8000-000000000098" })],
  ])("does not read or write legacy projects for an unbound %s", (_label, session) => {
    const context = createOperationFixtureContext(session);
    const browserStorage = storage();
    const detail = getProjectDetailMock(mockProjects[0].id)!;

    expect(readLocalProjects(context, { storage: browserStorage })).toEqual([]);
    expect(() => saveLocalProject(context, detail, { storage: browserStorage })).toThrow(
      "当前真实身份未绑定本地项目夹具",
    );
    expect(browserStorage.getItem).not.toHaveBeenCalled();
    expect(browserStorage.setItem).not.toHaveBeenCalled();
  });

  it("records the authenticated creator separately from the selected project owner", () => {
    const browserStorage = storage();
    const owner = mockMembers[1];
    const detail = createLocalProject(boundContext, {
      name: "Identity audit project",
      description: "Creator and owner are deliberately different.",
      ownerId: owner.id,
      memberIds: [owner.id],
      startDate: "2026-08-10",
      dueDate: "2026-09-10",
      priority: "high",
      status: "planning",
    }, executiveWorkspaceSession.actor, {
      storage: browserStorage,
      now: () => new Date("2026-08-10T08:00:00.000Z"),
      createId: () => crypto.randomUUID(),
    });

    expect(detail.project.ownerId).toBe(owner.id);
    expect(detail.project.createdById).toBe(executiveWorkspaceSession.actor.memberId);
    expect(detail.activities[0]).toMatchObject({
      userId: executiveWorkspaceSession.actor.id,
      actionType: "project_created",
    });
    expect(detail.activities[0].content).toContain(executiveWorkspaceSession.actor.name);
    expect(detail.activities[0].content).not.toContain(owner.displayName);
  });
});
