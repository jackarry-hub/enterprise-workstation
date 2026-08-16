import type { WorkspaceRole } from "@/features/auth/workspace-session-types";

const roleRoutePrefixes: Record<WorkspaceRole, readonly string[]> = {
  // Attendance stays directly accessible because HR and payroll closure actions link to its operating panels.
  executive: [
    "/me",
    "/help",
    "/notifications",
    "/dashboard",
    "/decision",
    "/projects",
    "/activities",
    "/tasks",
    "/execution",
    "/attendance",
    "/approvals",
    "/people",
    "/payroll",
    "/customers",
    "/analytics",
    "/settings",
  ],
  department_head: [
    "/me",
    "/dashboard",
    "/decision",
    "/help",
    "/notifications",
    "/department",
    "/projects",
    "/activities",
    "/tasks",
    "/people",
    "/attendance",
    "/leave",
    "/payroll",
    "/approvals",
    "/analytics",
    "/execution",
    "/settings",
  ],
  employee: [
    "/me",
    "/dashboard",
    "/projects",
    "/help",
    "/notifications",
    "/execution",
    "/tasks",
    "/attendance",
    "/leave",
    "/payroll",
    "/approvals",
    "/settings",
  ],
  finance: [
    "/me",
    "/dashboard",
    "/decision",
    "/projects",
    "/help",
    "/notifications",
    "/finance",
    "/tasks",
    "/approvals",
    "/payroll",
    "/attendance",
    "/leave",
    "/execution",
    "/settings",
  ],
  hr: [
    "/me",
    "/dashboard",
    "/decision",
    "/projects",
    "/help",
    "/notifications",
    "/hr",
    "/tasks",
    "/people",
    "/attendance",
    "/leave",
    "/payroll",
    "/approvals",
    "/execution",
    "/settings",
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
