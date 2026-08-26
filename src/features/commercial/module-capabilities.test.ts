import { describe, expect, it } from "vitest";

import {
  getModuleCapabilities,
  getVisibleQuickWorkspaceActions,
} from "@/features/commercial/module-capabilities";
import {
  executiveWorkspaceSession,
} from "@/test/workspace-session-test-utils";
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

describe("commercial module capabilities", () => {
  it("derives capabilities from the verified session permissions", () => {
    const employeeSession = sessionWithPermissions(["task.execute"]);
    const capabilities = getModuleCapabilities(employeeSession);

    expect(capabilities.tasks).toBe(true);
    expect(capabilities.settings).toBe(false);
    expect(capabilities.attendance).toBe(false);
    expect(capabilities.leave).toBe(false);
  });

  it("does not publish unfinished or hidden-scope actions to quick create", () => {
    const employeeSession = sessionWithPermissions(["task.execute"]);

    expect(getVisibleQuickWorkspaceActions(employeeSession, "/leave")).toEqual([]);
    expect(getVisibleQuickWorkspaceActions(employeeSession, "/attendance")).toEqual([]);
  });
});
