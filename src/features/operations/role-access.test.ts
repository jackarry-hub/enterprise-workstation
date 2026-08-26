import { describe, expect, it } from "vitest";

import { canRoleAccessPath } from "@/features/operations/role-access";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

function session(roleCodes: WorkspaceSession["roleCodes"], permissionCodes: WorkspaceSession["permissionCodes"]) {
  return { ...executiveWorkspaceSession, roleCodes, permissionCodes };
}

describe("role access policy", () => {
  it("keeps every role inside its own workstation", () => {
    expect(canRoleAccessPath(session(["owner"], ["dashboard.read"]), "/dashboard")).toBe(true);
    expect(canRoleAccessPath(session(["owner"], ["dashboard.read"]), "/finance")).toBe(false);
    expect(canRoleAccessPath(session(["department_head"], ["project.manage"]), "/department")).toBe(true);
    expect(canRoleAccessPath(session(["department_head"], ["project.manage"]), "/projects/demo-project")).toBe(true);
    expect(canRoleAccessPath(session(["employee"], ["task.execute"]), "/execution")).toBe(true);
    expect(canRoleAccessPath(session(["employee"], ["task.execute"]), "/people")).toBe(false);
    expect(canRoleAccessPath(session(["finance"], ["salary.manage"]), "/payroll")).toBe(true);
    expect(canRoleAccessPath(session(["finance"], ["salary.manage"]), "/hr")).toBe(false);
    expect(canRoleAccessPath(session(["hr"], ["hr.manage"]), "/people/employee-1")).toBe(true);
    expect(canRoleAccessPath(session(["hr"], ["hr.manage"]), "/analytics")).toBe(false);
  });

  it("removes the standalone knowledge module for every role", () => {
    for (const role of [["owner"], ["department_head"], ["employee"], ["finance"], ["hr"]] as const) {
      expect(canRoleAccessPath(session([...role], ["knowledge.manage"]), "/knowledge")).toBe(false);
    }
  });

  it("allows every role to use help and its own notification center", () => {
    for (const role of [["owner"], ["department_head"], ["employee"], ["finance"], ["hr"]] as const) {
      expect(canRoleAccessPath(session([...role], []), "/help")).toBe(true);
      expect(canRoleAccessPath(session([...role], []), "/notifications")).toBe(true);
    }
  });

  it("lets every role deliver tasks but removes attendance from every route policy", () => {
    for (const role of [["owner"], ["department_head"], ["employee"], ["finance"], ["hr"]] as const) {
      expect(canRoleAccessPath(session([...role], ["task.execute"]), "/tasks")).toBe(true);
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
