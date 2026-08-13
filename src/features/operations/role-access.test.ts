import { describe, expect, it } from "vitest";

import { canRoleAccessPath } from "@/features/operations/role-access";
import type { WorkspaceRole } from "@/features/auth/workspace-session-types";

const workspaceRoles = [
  "executive",
  "department_head",
  "employee",
  "finance",
  "hr",
] as const satisfies readonly WorkspaceRole[];

describe("role access policy", () => {
  it("lets every role use every mobile primary destination", () => {
    for (const role of workspaceRoles) {
      for (const path of ["/dashboard", "/tasks", "/projects", "/approvals", "/me"]) {
        expect(canRoleAccessPath(role, path)).toBe(true);
      }
    }
  });

  it("lets every role reach the personal profile destinations", () => {
    for (const role of workspaceRoles) {
      for (const path of ["/attendance", "/payroll", "/execution", "/settings"]) {
        expect(canRoleAccessPath(role, path)).toBe(true);
      }
    }
  });

  it("keeps every role inside its own workstation", () => {
    expect(canRoleAccessPath("executive", "/dashboard")).toBe(true);
    expect(canRoleAccessPath("executive", "/finance")).toBe(false);
    expect(canRoleAccessPath("department_head", "/department")).toBe(true);
    expect(canRoleAccessPath("department_head", "/projects/demo-project")).toBe(true);
    expect(canRoleAccessPath("employee", "/execution")).toBe(true);
    expect(canRoleAccessPath("employee", "/people")).toBe(false);
    expect(canRoleAccessPath("finance", "/payroll")).toBe(true);
    expect(canRoleAccessPath("finance", "/hr")).toBe(false);
    expect(canRoleAccessPath("hr", "/people/employee-1")).toBe(true);
    expect(canRoleAccessPath("hr", "/analytics")).toBe(false);
  });

  it("removes the standalone knowledge module for every role", () => {
    for (const role of workspaceRoles) {
      expect(canRoleAccessPath(role, "/knowledge")).toBe(false);
    }
  });

  it("allows every role to use help and its own notification center", () => {
    for (const role of workspaceRoles) {
      expect(canRoleAccessPath(role, "/help")).toBe(true);
      expect(canRoleAccessPath(role, "/notifications")).toBe(true);
    }
  });

  it("lets department heads open payroll in personal payslip mode", () => {
    expect(canRoleAccessPath("department_head", "/payroll")).toBe(true);
  });

  it("lets every role deliver tasks and open the attendance operating workspace", () => {
    for (const role of workspaceRoles) {
      expect(canRoleAccessPath(role, "/tasks")).toBe(true);
      expect(canRoleAccessPath(role, "/attendance")).toBe(true);
    }
  });
});
