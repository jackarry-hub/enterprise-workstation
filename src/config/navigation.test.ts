import { describe, expect, it } from "vitest";

import { getVisibleNavigationItems, navigationItems } from "@/config/navigation";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("workspace navigation", () => {
  it("uses the server session capability for task delivery and omits excluded modules", () => {
    const taskItem = getVisibleNavigationItems({
      ...executiveWorkspaceSession,
      permissionCodes: ["task.manage"],
    }).find(({ href }) => href === "/tasks");

    expect(taskItem).toMatchObject({ href: "/tasks", module: "tasks", available: true });
    expect(navigationItems.find(({ href }) => href === "/tasks")?.module).toBe("tasks");
    expect(navigationItems.some(({ href }) => href === "/attendance")).toBe(false);
    expect(navigationItems.some(({ href }) => href === "/leave")).toBe(false);
  });
});
