import { describe, expect, it } from "vitest";

import { navigationItems } from "@/config/navigation";
import type { DemoRole } from "@/features/operations/operations-types";

const everyRole: readonly DemoRole[] = [
  "executive",
  "department_head",
  "employee",
  "finance",
  "hr",
];

describe("workspace navigation", () => {
  it("uses task delivery instead of clock-in attendance for every role", () => {
    const taskItem = navigationItems.find(({ href }) => href === "/tasks");

    expect(taskItem?.available).toBe(true);
    expect(taskItem?.roles).toEqual(everyRole);
    expect(navigationItems.some(({ href }) => href === "/attendance")).toBe(false);
  });
});
