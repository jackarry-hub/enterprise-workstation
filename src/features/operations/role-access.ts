import type { DemoRole } from "@/features/operations/operations-types";

const roleRoutePrefixes: Record<DemoRole, readonly string[]> = {
  // Keep /attendance accessible only so legacy bookmarks can reach its server redirect to /tasks.
  executive: [
    "/help",
    "/notifications",
    "/dashboard",
    "/projects",
    "/activities",
    "/tasks",
    "/attendance",
    "/approvals",
    "/people",
    "/payroll",
    "/customers",
    "/analytics",
    "/settings",
  ],
  department_head: [
    "/help",
    "/notifications",
    "/department",
    "/projects",
    "/activities",
    "/tasks",
    "/people",
    "/attendance",
    "/leave",
    "/approvals",
    "/analytics",
  ],
  employee: [
    "/help",
    "/notifications",
    "/execution",
    "/tasks",
    "/attendance",
    "/leave",
    "/payroll",
    "/approvals",
  ],
  finance: [
    "/help",
    "/notifications",
    "/finance",
    "/tasks",
    "/approvals",
    "/payroll",
    "/attendance",
    "/leave",
  ],
  hr: [
    "/help",
    "/notifications",
    "/hr",
    "/tasks",
    "/people",
    "/attendance",
    "/leave",
    "/payroll",
    "/approvals",
  ],
};

export function canRoleAccessPath(role: DemoRole, pathname: string) {
  return roleRoutePrefixes[role].some((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ));
}

export function getRoleRoutePrefixes(role: DemoRole) {
  return roleRoutePrefixes[role];
}
