import type { DemoRole } from "@/features/operations/operations-types";

const roleRoutePrefixes: Record<DemoRole, readonly string[]> = {
  executive: [
    "/help",
    "/notifications",
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
    "/approvals",
    "/payroll",
    "/attendance",
    "/leave",
  ],
  hr: [
    "/help",
    "/notifications",
    "/hr",
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
