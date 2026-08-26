import type {
  WorkspacePermissionCode,
  WorkspaceSession,
} from "@/features/auth/workspace-session-types";

export type CommercialModule =
  | "dashboard"
  | "department"
  | "execution"
  | "finance"
  | "hr"
  | "projects"
  | "activities"
  | "tasks"
  | "people"
  | "payroll"
  | "approvals"
  | "customers"
  | "analytics"
  | "settings"
  | "notifications"
  | "help"
  | "knowledge"
  | "attendance"
  | "leave"
  | "fused";

export type CommercialModuleDefinition = {
  readonly routes: readonly string[];
  readonly requiredPermissions: readonly WorkspacePermissionCode[];
  readonly available: boolean;
};

export const commercialModuleRegistry: Readonly<Record<CommercialModule, CommercialModuleDefinition>> = {
  dashboard: { routes: ["/dashboard"], requiredPermissions: ["dashboard.read"], available: true },
  department: { routes: ["/department"], requiredPermissions: ["project.manage"], available: true },
  execution: { routes: ["/execution"], requiredPermissions: ["task.execute"], available: true },
  finance: { routes: ["/finance"], requiredPermissions: ["expense.manage", "salary.manage"], available: true },
  hr: { routes: ["/hr"], requiredPermissions: ["hr.manage"], available: true },
  projects: { routes: ["/projects"], requiredPermissions: ["project.read", "project.create", "project.manage"], available: true },
  activities: { routes: ["/activities"], requiredPermissions: ["project.manage", "task.manage"], available: true },
  tasks: { routes: ["/tasks"], requiredPermissions: ["task.execute", "task.manage"], available: true },
  people: { routes: ["/people"], requiredPermissions: ["hr.manage", "organization.manage", "department.manage"], available: true },
  payroll: { routes: ["/payroll"], requiredPermissions: ["salary.self", "salary.manage"], available: true },
  approvals: { routes: ["/approvals"], requiredPermissions: ["approval.self", "approval.manage", "approval.submit", "approval.act"], available: true },
  customers: { routes: ["/customers"], requiredPermissions: ["customer.manage"], available: true },
  analytics: { routes: ["/analytics"], requiredPermissions: ["analytics.read"], available: true },
  settings: { routes: ["/settings"], requiredPermissions: ["settings.manage", "organization.manage", "role.manage", "ai.config.manage"], available: true },
  notifications: { routes: ["/notifications"], requiredPermissions: [], available: true },
  help: { routes: ["/help"], requiredPermissions: [], available: true },
  knowledge: { routes: ["/knowledge"], requiredPermissions: ["knowledge.manage"], available: false },
  attendance: { routes: ["/attendance"], requiredPermissions: [], available: false },
  leave: { routes: ["/leave"], requiredPermissions: [], available: false },
  fused: { routes: ["/quantxy-ai-workbench-fused.html"], requiredPermissions: [], available: false },
};

export type ContextualCreateAction = {
  readonly pathname: string;
  readonly module: CommercialModule;
  readonly requiredPermission: WorkspacePermissionCode;
  readonly label: string;
};

// No create command is registered until its Route Handler and RPC are commercial-ready.
export const contextualCreateActions: readonly ContextualCreateAction[] = [];

export function getModuleCapabilities(
  session: WorkspaceSession,
): Readonly<Record<CommercialModule, boolean>> {
  return Object.fromEntries(
    (Object.keys(commercialModuleRegistry) as CommercialModule[]).map((module) => [
      module,
      hasModuleCapability(session, module),
    ]),
  ) as Record<CommercialModule, boolean>;
}

export function hasModuleCapability(
  session: WorkspaceSession,
  module: CommercialModule,
) {
  const definition = commercialModuleRegistry[module];
  return definition.available
    && (definition.requiredPermissions.length === 0
      || definition.requiredPermissions.some((permission) => session.permissionCodes.includes(permission)));
}

export function getCommercialModuleForPath(pathname: string): CommercialModule | null {
  for (const [module, definition] of Object.entries(commercialModuleRegistry) as [CommercialModule, CommercialModuleDefinition][]) {
    if (definition.routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
      return module;
    }
  }
  return null;
}

export function getVisibleQuickWorkspaceActions(
  session: WorkspaceSession,
  pathname: string,
) {
  const capabilities = getModuleCapabilities(session);
  return contextualCreateActions.filter((action) => (
    action.pathname === pathname
    && capabilities[action.module]
    && session.permissionCodes.includes(action.requiredPermission)
  ));
}
