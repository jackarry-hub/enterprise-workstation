import { describe, expect, it } from "vitest";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import {
  createOperationFixtureContext,
  toOperationFixtureActor,
} from "@/features/operations/operation-actor-compat";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

function session(overrides: Partial<WorkspaceSession> = {}): WorkspaceSession {
  return {
    ...executiveWorkspaceSession,
    ...overrides,
    actor: {
      ...executiveWorkspaceSession.actor,
      id: overrides.authUserId ?? executiveWorkspaceSession.authUserId,
      memberId: String(overrides.member?.id ?? executiveWorkspaceSession.member.id),
      ...overrides.actor,
    },
  };
}

describe("workspace actor operation fixture compatibility", () => {
  it("binds only the exact tenant, authenticated user, membership, and role tuple", () => {
    const boundSession = session();

    expect(toOperationFixtureActor(boundSession)).toMatchObject({
      id: "actor-executive",
      memberId: "20000000-0000-4000-8000-000000000010",
      name: boundSession.profile.displayName,
      role: "executive",
    });
  });

  it.each([
    ["same role, different user", { authUserId: "10000000-0000-4000-8000-000000000099" }],
    ["same role, different tenant", { tenantId: "10000000-0000-4000-8000-000000000098" }],
    ["same role, different member", { member: { ...executiveWorkspaceSession.member, id: 99 } }],
    ["same identity, different role", {
      primaryRole: "employee" as const,
      actor: { ...executiveWorkspaceSession.actor, role: "employee" as const },
    }],
  ])("fails closed for %s", (_label, overrides) => {
    expect(toOperationFixtureActor(session(overrides))).toBeNull();
  });

  it("creates a tenant/user/member namespaced storage identity only for an explicit binding", () => {
    const bound = createOperationFixtureContext(session());
    const unbound = createOperationFixtureContext(session({
      authUserId: "10000000-0000-4000-8000-000000000099",
    }));

    expect(bound.storageNamespace).toBe(
      "10000000-0000-4000-8000-000000000000:10000000-0000-4000-8000-000000000001:10",
    );
    expect(unbound).toMatchObject({ actor: null, storageNamespace: null });
  });
});
