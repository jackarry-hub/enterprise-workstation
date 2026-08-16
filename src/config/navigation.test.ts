import { describe, expect, it } from "vitest";

import { navigationItems } from "@/config/navigation";
import type { WorkspaceRole } from "@/features/auth/workspace-session-types";

const everyRole: readonly WorkspaceRole[] = [
  "executive",
  "department_head",
  "employee",
  "finance",
  "hr",
];

describe("workspace navigation", () => {
  it("uses one unified AI enterprise brain home for every role", () => {
    const homeItems = navigationItems.filter(({ href }) => href === "/dashboard");

    expect(homeItems).toHaveLength(1);
    expect(homeItems[0]).toMatchObject({
      label: "AI企业大脑",
      available: true,
      roles: everyRole,
    });
    expect(navigationItems.some(({ href }) => ["/decision", "/department", "/execution", "/finance", "/hr"].includes(href))).toBe(false);
  });

  it("uses task delivery instead of clock-in attendance for every role", () => {
    const taskItem = navigationItems.find(({ href }) => href === "/tasks");

    expect(taskItem?.available).toBe(true);
    expect(taskItem?.roles).toEqual(everyRole);
    expect(navigationItems.some(({ href }) => href === "/attendance")).toBe(false);
  });

  it("gives every role a personal payroll entry", () => {
    const payrollItem = navigationItems.find(({ href }) => href === "/payroll");

    expect(payrollItem?.available).toBe(true);
    expect(payrollItem?.roles).toEqual(everyRole);
  });
});
