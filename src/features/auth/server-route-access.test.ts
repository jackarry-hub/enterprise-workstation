import { describe, expect, it } from "vitest";

import { assertServerRouteAccess } from "@/features/auth/server-route-access";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

function sessionWithPermissions(permissionCodes: WorkspaceSession["permissionCodes"]): WorkspaceSession {
  return {
    ...executiveWorkspaceSession,
    roleCodes: ["employee"],
    primaryRole: "employee",
    landingPath: "/execution",
    permissionCodes,
    actor: {
      ...executiveWorkspaceSession.actor,
      role: "employee",
      landingPath: "/execution",
    },
  };
}

describe("server route access", () => {
  it("rejects direct routes without a server-derived capability", () => {
    const employeeSession = sessionWithPermissions(["task.manage"]);

    expect(() => assertServerRouteAccess(employeeSession, "/settings")).toThrow("route_forbidden");
  });

  it("denies hidden attendance and leave routes even when a legacy permission is present", () => {
    const employeeSession = sessionWithPermissions(["attendance.self", "task.execute"]);

    expect(() => assertServerRouteAccess(employeeSession, "/attendance")).toThrow("route_forbidden");
    expect(() => assertServerRouteAccess(employeeSession, "/leave")).toThrow("route_forbidden");
  });

  it("fails closed for an unregistered workspace page", () => {
    const employeeSession = sessionWithPermissions(["task.execute"]);

    expect(() => assertServerRouteAccess(employeeSession, "/workspace")).toThrow("route_forbidden");
  });

  it("allows a capability route and its nested pages", () => {
    const employeeSession = sessionWithPermissions(["task.execute"]);

    expect(() => assertServerRouteAccess(employeeSession, "/tasks")).toThrow("route_forbidden");
    expect(() => assertServerRouteAccess(employeeSession, "/tasks/task-1")).toThrow("route_forbidden");
  });
});
