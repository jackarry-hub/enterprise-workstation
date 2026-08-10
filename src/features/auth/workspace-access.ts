import type {
  DatabaseRoleCode,
  WorkspaceActor,
  WorkspacePermissionCode,
  WorkspaceRole,
  WorkspaceSession,
} from "@/features/auth/workspace-session-types";

const compatibilityIds = {
  executive: ["actor-executive", "20000000-0000-4000-8000-000000000010"],
  department_head: ["actor-manager", "20000000-0000-4000-8000-000000000001"],
  employee: ["actor-employee", "20000000-0000-4000-8000-000000000004"],
  finance: ["actor-finance", "20000000-0000-4000-8000-000000000007"],
  hr: ["actor-hr", "20000000-0000-4000-8000-000000000006"],
} as const;

const roleMapping: Record<Exclude<DatabaseRoleCode, "admin">, WorkspaceRole> = {
  owner: "executive",
  department_head: "department_head",
  employee: "employee",
  finance: "finance",
  hr: "hr",
};

const rolePriority: Exclude<DatabaseRoleCode, "admin">[] = [
  "owner",
  "department_head",
  "finance",
  "hr",
  "employee",
];

const roleLabels: Record<WorkspaceRole, string> = {
  executive: "CEO",
  department_head: "管理层",
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
  "employee",
  "finance",
  "hr",
]);

const workspacePermissions = new Set<WorkspacePermissionCode>([
  "dashboard.read",
  "organization.manage",
  "department.manage",
  "project.manage",
  "task.manage",
  "hr.manage",
  "attendance.self",
  "attendance.manage",
  "salary.self",
  "salary.manage",
  "approval.self",
  "approval.manage",
  "files.manage",
]);

const UUID_PATTERN =
  /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

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
  const permissionCodes = enumArray(raw.permissionCodes, workspacePermissions);
  const skills = skillArray(raw.skills);
  if (!roleCodes || !permissionCodes || !skills) return null;

  const databaseRole = rolePriority.find((role) => roleCodes.includes(role));
  if (!databaseRole) return null;

  const primaryRole = roleMapping[databaseRole];
  const landingPath = landingPaths[primaryRole];
  const [id, memberId] = compatibilityIds[primaryRole];
  const actor: WorkspaceActor = {
    id,
    memberId,
    name: raw.displayName,
    role: primaryRole,
    roleLabel: roleLabels[primaryRole],
    department: raw.departmentName,
    title: raw.jobTitle,
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
      skills,
    },
    roleCodes,
    permissionCodes,
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
