import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  getModuleCapabilities,
  getVisibleQuickWorkspaceActions,
  commercialModuleRegistry,
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
    const employeeSession = sessionWithPermissions(["task.manage"]);
    const capabilities = getModuleCapabilities(employeeSession);

    expect(capabilities.execution).toBe(true);
    expect(commercialModuleRegistry.execution.requiredPermissions).toEqual(["task.manage"]);
    expect(capabilities.settings).toBe(true);
    expect(commercialModuleRegistry).not.toHaveProperty("attendance");
    expect(commercialModuleRegistry).not.toHaveProperty("leave");
  });

  it("tracks readiness explicitly for every registered production route", () => {
    for (const definition of Object.values(commercialModuleRegistry)) {
      if (definition.routes.length > 0) {
        expect(definition).toHaveProperty("commercialReady");
      }
    }

    expect(Object.entries(commercialModuleRegistry)
      .filter(([, definition]) => definition.commercialReady)
      .map(([module]) => module))
      .toEqual([
        "dashboard", "department", "execution", "finance", "hr", "projects", "activities", "tasks",
        "people", "payroll", "approvals", "customers", "analytics", "settings", "notifications", "help",
        "knowledge", "assistant", "scheduler", "agents",
      ]);

    expect(commercialModuleRegistry.people.requiredPermissions).toEqual([]);
    expect(getModuleCapabilities(sessionWithPermissions([])).people).toBe(true);
    expect(getModuleCapabilities(sessionWithPermissions(["knowledge.read"])).knowledge).toBe(true);
    expect(getModuleCapabilities(sessionWithPermissions([])).assistant).toBe(true);
    expect(getModuleCapabilities(sessionWithPermissions(["agent.orchestrate"])).scheduler).toBe(true);
    expect(getModuleCapabilities(sessionWithPermissions([])).agents).toBe(true);
  });

  it("aligns the execution requirement with the shipped employee role matrix", async () => {
    const matrix = await readFile(
      path.join(process.cwd(), "supabase/migrations/202608100001_phase1_identity_rbac.sql"),
      "utf8",
    );
    const laterAlignment = await readFile(
      path.join(process.cwd(), "supabase/migrations/202608210003_task_management_role_alignment.sql"),
      "utf8",
    );

    expect(matrix).toContain("('employee', 'task.manage')");
    expect(laterAlignment).toContain("permission.code = 'task.manage'");
    expect(commercialModuleRegistry.execution.requiredPermissions).toEqual(["task.manage"]);
  });

  it("routes role workbenches through real server-backed modules", async () => {
    const pages = await Promise.all(["department", "execution", "finance", "hr"].map((route) =>
      readFile(path.join(process.cwd(), "src", "app", "(workspace)", route, "page.tsx"), "utf8"),
    ));

    for (const source of pages) {
      expect(source).not.toContain("RoleWorkbench");
      expect(source).not.toContain("operations-data");
      expect(source).not.toContain("localStorage");
    }
  });

  it("does not publish unfinished or hidden-scope actions to quick create", () => {
    const employeeSession = sessionWithPermissions(["task.execute"]);

    expect(getVisibleQuickWorkspaceActions(employeeSession, "/leave")).toEqual([]);
    expect(getVisibleQuickWorkspaceActions(employeeSession, "/attendance")).toEqual([]);
  });

  it("only exposes the Agent page create action to Agent managers", () => {
    expect(getVisibleQuickWorkspaceActions(sessionWithPermissions([]), "/agents")).toEqual([]);
    expect(getVisibleQuickWorkspaceActions(sessionWithPermissions(["agent.manage"]), "/agents"))
      .toEqual([{ id: "agent.create", label: "新建 Agent", icon: "bot", module: "agents", requiredPermission: "agent.manage", target: "agent-editor" }]);
  });
});
