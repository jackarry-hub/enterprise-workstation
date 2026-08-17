import type { WorkspaceRole } from "@/features/auth/workspace-session-types";

const sharedWorkspaceRoutes = [
  "/help",
  "/notifications",
  "/tasks",
  "/attendance",
  "/api/ai",
  "/quantxy-ai-workbench-fused.html",
] as const;

const roleRoutePrefixes: Record<WorkspaceRole, readonly string[]> = {
  // Keep /attendance accessible only so legacy bookmarks can reach its server redirect to /tasks.
  executive: [
    ...sharedWorkspaceRoutes,
    "/dashboard",
    "/projects",
    "/activities",
    "/approvals",
    "/people",
    "/payroll",
    "/customers",
    "/analytics",
    "/settings",
  ],
  department_head: [
    ...sharedWorkspaceRoutes,
    "/department",
    "/projects",
    "/activities",
    "/people",
    "/leave",
    "/approvals",
    "/analytics",
  ],
  employee: [
    ...sharedWorkspaceRoutes,
    "/execution",
    "/leave",
    "/payroll",
    "/approvals",
  ],
  finance: [
    ...sharedWorkspaceRoutes,
    "/finance",
    "/approvals",
    "/payroll",
    "/leave",
  ],
  hr: [
    ...sharedWorkspaceRoutes,
    "/hr",
    "/people",
    "/leave",
    "/payroll",
    "/approvals",
  ],
};

export function canRoleAccessPath(role: WorkspaceRole, pathname: string) {
  return roleRoutePrefixes[role].some((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ));
}

export function getRoleRoutePrefixes(role: WorkspaceRole) {
  return roleRoutePrefixes[role];
}
