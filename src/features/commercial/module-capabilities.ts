import type {
  WorkspacePermissionCode,
  WorkspaceSession,
} from "@/features/auth/workspace-session-types";
import { getContextualCreateActions, type ContextualCreateAction } from "@/features/quick-create/contextual-create-actions";
export type { ContextualCreateAction } from "@/features/quick-create/contextual-create-actions";

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
  | "assistant"
  | "scheduler"
  | "agents"
  | "attendance"
  | "leave"
  | "fused";

export type CommercialModuleDefinition = {
  readonly routes: readonly string[];
  readonly requiredPermissions: readonly WorkspacePermissionCode[];
  readonly commercialReady: boolean;
};

export const commercialModuleRegistry: Readonly<Record<CommercialModule, CommercialModuleDefinition>> = {
  dashboard: { routes: ["/dashboard"], requiredPermissions: ["dashboard.read"], commercialReady: false },
  department: { routes: ["/department"], requiredPermissions: ["project.manage"], commercialReady: false },
  execution: { routes: ["/execution"], requiredPermissions: ["task.manage"], commercialReady: false },
  finance: { routes: ["/finance"], requiredPermissions: ["expense.manage", "salary.manage"], commercialReady: false },
  hr: { routes: ["/hr"], requiredPermissions: ["hr.manage"], commercialReady: false },
  projects: { routes: ["/projects"], requiredPermissions: ["project.read", "project.create", "project.manage"], commercialReady: false },
  activities: { routes: ["/activities"], requiredPermissions: ["project.manage", "task.manage"], commercialReady: false },
  tasks: { routes: ["/tasks"], requiredPermissions: ["task.manage"], commercialReady: false },
  people: { routes: ["/people"], requiredPermissions: [], commercialReady: true },
  payroll: { routes: ["/payroll"], requiredPermissions: ["salary.self", "salary.manage"], commercialReady: false },
  approvals: { routes: ["/approvals"], requiredPermissions: ["approval.self", "approval.manage", "approval.submit", "approval.act", "expense.submit", "expense.manage"], commercialReady: true },
  customers: { routes: ["/customers"], requiredPermissions: ["customer.manage"], commercialReady: false },
  analytics: { routes: ["/analytics"], requiredPermissions: ["analytics.read"], commercialReady: true },
  settings: { routes: ["/settings"], requiredPermissions: [], commercialReady: true },
  notifications: { routes: ["/notifications"], requiredPermissions: [], commercialReady: true },
  help: { routes: ["/help"], requiredPermissions: [], commercialReady: true },
  knowledge: { routes: ["/knowledge"], requiredPermissions: ["knowledge.read", "knowledge.manage"], commercialReady: true },
  assistant: { routes: ["/assistant"], requiredPermissions: [], commercialReady: true },
  scheduler: { routes: ["/scheduler"], requiredPermissions: ["agent.orchestrate"], commercialReady: true },
  agents: { routes: ["/agents"], requiredPermissions: [], commercialReady: true },
  attendance: { routes: ["/attendance"], requiredPermissions: [], commercialReady: false },
  leave: { routes: ["/leave"], requiredPermissions: [], commercialReady: false },
  fused: { routes: ["/quantxy-ai-workbench-fused.html"], requiredPermissions: [], commercialReady: false },
};

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
  return definition.commercialReady
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
  return getContextualCreateActions({ pathname, session, capabilities: getModuleCapabilities(session) });
}
