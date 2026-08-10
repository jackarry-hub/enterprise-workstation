import { describe, expect, it } from "vitest";

import { canRoleAccessPath } from "@/features/operations/role-access";

describe("role access policy", () => {
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
    for (const role of ["executive", "department_head", "employee", "finance", "hr"] as const) {
      expect(canRoleAccessPath(role, "/knowledge")).toBe(false);
    }
  });

  it("allows every role to use help and its own notification center", () => {
    for (const role of ["executive", "department_head", "employee", "finance", "hr"] as const) {
      expect(canRoleAccessPath(role, "/help")).toBe(true);
      expect(canRoleAccessPath(role, "/notifications")).toBe(true);
    }
  });

  it("lets every role deliver tasks and follow old attendance bookmarks to that work", () => {
    for (const role of ["executive", "department_head", "employee", "finance", "hr"] as const) {
      expect(canRoleAccessPath(role, "/tasks")).toBe(true);
      expect(canRoleAccessPath(role, "/attendance")).toBe(true);
    }
  });
});
