import { describe, expect, it } from "vitest";

import type { WorkspaceActor, WorkspaceRole } from "@/features/auth/workspace-session-types";
import { toOperationFixtureActor } from "@/features/operations/operation-actor-compat";

const expectedIdsByRole: Record<
  WorkspaceRole,
  { id: string; memberId: string }
> = {
  executive: {
    id: "actor-executive",
    memberId: "20000000-0000-4000-8000-000000000010",
  },
  department_head: {
    id: "actor-manager",
    memberId: "20000000-0000-4000-8000-000000000001",
  },
  employee: {
    id: "actor-employee",
    memberId: "20000000-0000-4000-8000-000000000004",
  },
  finance: {
    id: "actor-finance",
    memberId: "20000000-0000-4000-8000-000000000007",
  },
  hr: {
    id: "actor-hr",
    memberId: "20000000-0000-4000-8000-000000000006",
  },
};

describe("workspace actor operation fixture compatibility", () => {
  it.each(Object.entries(expectedIdsByRole) as Array<[
    WorkspaceRole,
    { id: string; memberId: string },
  ]>)("maps %s to its fixture identifiers while preserving trusted profile fields", (role, expectedIds) => {
    const actor: WorkspaceActor = {
      id: `authenticated-${role}`,
      memberId: `database-member-${role}`,
      name: `真实姓名-${role}`,
      role,
      roleLabel: `真实角色-${role}`,
      department: `真实部门-${role}`,
      title: `真实岗位-${role}`,
      landingPath: `/${role}`,
    };

    expect(toOperationFixtureActor(actor)).toEqual({
      ...actor,
      ...expectedIds,
    });
  });
});
