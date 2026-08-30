import type {
  CustomWorkspaceRoleCode,
  DatabaseRoleCode,
  WorkspaceActor,
  WorkspacePermissionCode,
  WorkspaceRole,
  WorkspaceSession,
} from "@/features/auth/workspace-session-types";

export const FORMAL_WORKSTATION_PATH =
  "/quantxy-ai-workbench-fused.html?formal=1";

const roleMapping: Record<Exclude<DatabaseRoleCode, "admin">, WorkspaceRole> = {
  owner: "executive",
  department_head: "department_head",
  supervisor: "employee",
  employee: "employee",
  finance: "finance",
  hr: "hr",
};

const rolePriority: Exclude<DatabaseRoleCode, "admin">[] = [
  "owner",
  "department_head",
  "finance",
  "hr",
  "supervisor",
  "employee",
];

const databaseRoleLabels: Record<Exclude<DatabaseRoleCode, "admin">, string> = {
  owner: "CEO",
  department_head: "管理层",
  supervisor: "主管",
  employee: "普通员工",
  finance: "财务",
  hr: "人事",
};

const landingPaths: Record<WorkspaceRole, string> = {
  executive: "/dashboard",
  department_head: "/department",
  employee: "/execution",
  finance: "/finance",
  hr: "/hr",
};

const databaseRoles = new Set<DatabaseRoleCode>([
  "owner",
  "admin",
  "department_head",
  "supervisor",
  "employee",
  "finance",
  "hr",
]);

const workspacePermissions = new Set<WorkspacePermissionCode>([
  "dashboard.read",
  "organization.manage",
  "department.manage",
  "project.read",
  "project.create",
  "project.manage",
  "project.comment",
  "project.files",
  "project.report",
  "task.execute",
  "task.manage",
  "hr.manage",
  "attendance.self",
  "attendance.manage",
  "salary.self",
  "salary.manage",
  "approval.self",
  "approval.manage",
  "files.manage",
  "ai.config.manage",
  "role.manage",
  "customer.manage",
  "customer.import",
  "customer.export",
  "customer.export_pii",
  "approval.submit",
  "approval.act",
  "expense.submit",
  "expense.manage",
  "knowledge.manage",
  "agent.manage",
  "agent.orchestrate",
  "analytics.read",
  "settings.manage",
  "employee.supervisor.read",
]);

const UUID_PATTERN =
  /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const SALARY_GRADE_PATTERN = /^[A-Z][A-Z0-9]{1,11}$/;
const CUSTOM_WORKSPACE_ROLE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function enumArray<T extends string>(
  value: unknown,
  allowedValues: ReadonlySet<T>,
): T[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: T[] = [];
  const seen = new Set<T>();
  for (const item of value) {
    if (typeof item !== "string" || !allowedValues.has(item as T)) return null;
    const parsedItem = item as T;
    if (seen.has(parsedItem)) return null;
    seen.add(parsedItem);
    parsed.push(parsedItem);
  }
  return parsed;
}

function customRoleCodeArray(value: unknown): CustomWorkspaceRoleCode[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: CustomWorkspaceRoleCode[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      !nonEmptyText(item)
      || seen.has(item)
      || databaseRoles.has(item as DatabaseRoleCode)
      || !CUSTOM_WORKSPACE_ROLE_CODE_PATTERN.test(item)
    ) {
      return null;
    }
    seen.add(item);
    parsed.push(item as CustomWorkspaceRoleCode);
  }
  return parsed;
}

function skillArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 30) return null;

  const skills: string[] = [];
  const seen = new Set<string>();
  for (const skill of value) {
    if (
      !nonEmptyText(skill) ||
      Array.from(skill).length > 40 ||
      skill !== skill.toLowerCase() ||
      seen.has(skill)
    ) {
      return null;
    }
    seen.add(skill);
    skills.push(skill);
  }
  return skills;
}

function uuidArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!uuid(item) || seen.has(item)) return null;
    seen.add(item);
    parsed.push(item);
  }
  return parsed;
}

function optionalSalaryGradeCode(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !SALARY_GRADE_PATTERN.test(value)
  ) {
    return null;
  }
  return value;
}

function optionalJobLevel(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 20
    ? value as number
    : null;
}

export function parseWorkspaceAccess(value: unknown): WorkspaceSession | null {
  const raw = record(value);
  if (!raw) return null;

  if (
    !uuid(raw.tenantId) ||
    !uuid(raw.authUserId) ||
    !uuid(raw.organizationId) ||
    !uuid(raw.employeeProfileId) ||
    !Number.isSafeInteger(raw.memberId) ||
    (raw.memberId as number) <= 0 ||
    raw.memberStatus !== "active" ||
    !["probation", "active", "on_leave"].includes(
      typeof raw.employmentStatus === "string" ? raw.employmentStatus : "",
    ) ||
    !nonEmptyText(raw.organizationName) ||
    !nonEmptyText(raw.displayName) ||
    !nonEmptyText(raw.departmentName) ||
    !nonEmptyText(raw.jobTitle) ||
    !nonEmptyText(raw.providerCode) ||
    raw.providerCode !== raw.providerCode.toLowerCase() ||
    !nonEmptyText(raw.authProvider) ||
    !nonEmptyText(raw.providerSubject) ||
    (raw.avatarUrl !== null && !nonEmptyText(raw.avatarUrl))
  ) {
    return null;
  }

  const roleCodes = enumArray(raw.roleCodes, databaseRoles);
  const customRoleCodes = customRoleCodeArray(raw.customRoleCodes);
  const permissionCodes = enumArray(raw.permissionCodes, workspacePermissions);
  const supervisorScopeEmployeeIds = raw.supervisorScopeEmployeeIds === undefined
    ? []
    : uuidArray(raw.supervisorScopeEmployeeIds);
  const skills = skillArray(raw.skills);
  const salaryGradeCode = optionalSalaryGradeCode(raw.salaryGradeCode);
  const jobLevel = optionalJobLevel(raw.jobLevel);
  if (!roleCodes || !customRoleCodes || !permissionCodes || !supervisorScopeEmployeeIds || !skills || salaryGradeCode === null || jobLevel === null) return null;

  const databaseRole = rolePriority.find((role) => roleCodes.includes(role));
  if (!databaseRole && customRoleCodes.length === 0) return null;

  const primaryRole = databaseRole ? roleMapping[databaseRole] : "employee";
  const landingPath = databaseRole
    ? landingPaths[primaryRole]
    : permissionCodes.some((permission) => permission.startsWith("approval.") || permission.startsWith("expense."))
      ? "/approvals"
      : "/help";
  const actor: WorkspaceActor = {
    id: raw.authUserId,
    memberId: String(raw.memberId),
    name: raw.displayName,
    role: primaryRole,
    roleLabel: databaseRole ? databaseRoleLabels[databaseRole] : "自定义岗位",
    department: raw.departmentName,
    title: raw.jobTitle,
    salaryGradeCode,
    jobLevel,
    landingPath,
  };

  return {
    tenantId: raw.tenantId,
    authUserId: raw.authUserId,
    identity: {
      providerCode: raw.providerCode,
      authProvider: raw.authProvider,
      providerSubject: raw.providerSubject,
    },
    organization: { id: raw.organizationId, name: raw.organizationName },
    member: {
      id: raw.memberId as number,
      employeeProfileId: raw.employeeProfileId,
      status: "active",
    },
    profile: {
      displayName: raw.displayName,
      avatarUrl: raw.avatarUrl,
      departmentName: raw.departmentName,
      jobTitle: raw.jobTitle,
      salaryGradeCode,
      jobLevel,
      skills,
    },
    roleCodes,
    customRoleCodes,
    permissionCodes,
    supervisorScopeEmployeeIds,
    primaryRole,
    landingPath,
    isAdmin: roleCodes.includes("admin"),
    actor,
  };
}

export function hasWorkspacePermission(
  session: WorkspaceSession,
  permission: WorkspacePermissionCode,
) {
  return session.permissionCodes.includes(permission);
}

export function canReadSupervisorScope(
  session: WorkspaceSession,
  memberPublicId: string,
) {
  return UUID_PATTERN.test(memberPublicId)
    && session.supervisorScopeEmployeeIds.includes(memberPublicId);
}

export type WorkspaceAccessFailureReason =
  | "not_provisioned"
  | "suspended"
  | "departed"
  | "misconfigured";

export function isPublicAuthPath(pathname: string) {
  return pathname === "/login"
    || pathname === "/auth/login/feishu"
    || pathname === "/access-pending"
    || pathname === "/auth/callback"
    || pathname.startsWith("/auth/callback/")
    || pathname === "/api/auth/feishu/userinfo";
}

export function getSafeReturnPath(candidate: string | null | undefined) {
  if (
    !candidate
    || hasUnsafeReturnPathText(candidate)
    || hasMalformedPercentEncoding(candidate)
    || !candidate.startsWith("/")
    || candidate.startsWith("//")
  ) {
    return null;
  }

  let decoded = candidate;
  while (PERCENT_ESCAPE_PATTERN.test(decoded)) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (hasUnsafeReturnPathText(next) || next.startsWith("//")) return null;
    if (next === decoded || hasMalformedPercentEncoding(next)) break;
    decoded = next;
  }

  try {
    const base = new URL("https://workspace.invalid");
    const destination = new URL(candidate, base);
    if (destination.origin !== base.origin) return null;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

const PERCENT_ESCAPE_PATTERN = /%[0-9a-f]{2}/i;

function hasMalformedPercentEncoding(value: string) {
  return /%(?![0-9a-f]{2})/i.test(value);
}

function hasUnsafeReturnPathText(value: string) {
  return CONTROL_CHARACTER_PATTERN.test(value) || value.includes("\\");
}

export function getWorkspaceAccessFailureReason(
  value: unknown,
  error: unknown,
  expectedAuthUserId?: string,
): WorkspaceAccessFailureReason | null {
  if (error) return "misconfigured";
  if (value === null || value === undefined) return "not_provisioned";

  const raw = record(value);
  if (!raw) return "misconfigured";
  if (expectedAuthUserId && raw.authUserId !== expectedAuthUserId) {
    return "misconfigured";
  }
  if (raw.memberStatus === "suspended") return "suspended";
  if (raw.employmentStatus === "departed") return "departed";

  return parseWorkspaceAccess(value) ? null : "misconfigured";
}
