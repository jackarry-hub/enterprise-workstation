import { describe, expect, it } from "vitest";

import { canRoleAccessPath } from "@/features/operations/role-access";
import { commercialModuleRegistry } from "@/features/commercial/module-capabilities";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

function session(roleCodes: WorkspaceSession["roleCodes"], permissionCodes: WorkspaceSession["permissionCodes"]) {
  return { ...executiveWorkspaceSession, roleCodes, permissionCodes };
}

describe("role access policy", () => {
  it("fails closed for every commercial route that is not ready", () => {
    for (const definition of Object.values(commercialModuleRegistry)) {
      if (definition.commercialReady) continue;
      for (const route of definition.routes) {
        expect(canRoleAccessPath(session(["owner"], ["dashboard.read", "task.manage", "project.manage"]), route)).toBe(false);
      }
    }
  });

  it("opens the knowledge workspace only to authenticated roles with knowledge access", () => {
    for (const role of [["owner"], ["department_head"], ["employee"], ["finance"], ["hr"]] as const) {
      expect(canRoleAccessPath(session([...role], ["knowledge.read"]), "/knowledge")).toBe(true);
      expect(canRoleAccessPath(session([...role], ["knowledge.manage"]), "/knowledge")).toBe(true);
      expect(canRoleAccessPath(session([...role], []), "/knowledge")).toBe(false);
    }
  });

  it("keeps help and the recipient-isolated notification center available for every authenticated role", () => {
    for (const role of [["owner"], ["department_head"], ["employee"], ["finance"], ["hr"]] as const) {
      expect(canRoleAccessPath(session([...role], []), "/help")).toBe(true);
      expect(canRoleAccessPath(session([...role], []), "/notifications")).toBe(true);
    }
  });

  it("removes task delivery, attendance, and leave from every route policy", () => {
    for (const role of [["owner"], ["department_head"], ["employee"], ["finance"], ["hr"]] as const) {
      expect(canRoleAccessPath(session([...role], ["task.manage"]), "/tasks")).toBe(false);
      expect(canRoleAccessPath(session([...role], ["attendance.self"]), "/attendance")).toBe(false);
      expect(canRoleAccessPath(session([...role], []), "/leave")).toBe(false);
    }
  });

  it("lets authenticated roles reach the standalone workstation and AI API boundary", () => {
    expect(canRoleAccessPath(session(["owner"], []), "/quantxy-ai-workbench-fused.html")).toBe(false);
    expect(canRoleAccessPath(session(["owner"], []), "/api/ai/config")).toBe(false);
    expect(canRoleAccessPath(session(["owner"], []), "/api/ai/chat")).toBe(false);
  });
});
