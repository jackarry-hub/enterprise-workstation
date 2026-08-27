import "server-only";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type OrganizationCommandClientFactory = () => Promise<SupabaseServerClient>;

type MemberRelation = {
  id: number;
  role_version: number;
  status: string;
} | readonly {
  id: number;
  role_version: number;
  status: string;
}[] | null;

type RoleCommandTargetRow = {
  public_id: string;
  display_name: string;
  employee_no: string;
  job_title: string;
  organization_id: number;
  organization_member_id: number | null;
  member: MemberRelation;
};

type OrganizationRow = { id: number };

type DepartmentRelation = {
  id: number;
  public_id: string;
  organization_id: number;
  name: string;
} | readonly {
  id: number;
  public_id: string;
  organization_id: number;
  name: string;
}[] | null;

type ManagerCommandTargetRow = {
  id: number;
  public_id: string;
  display_name: string;
  employee_no: string;
  job_title: string;
  organization_id: number;
  organization_member_id: number | null;
  department_id: number | null;
  manager_employee_id: number | null;
  manager_version: number;
  manager_source: string;
  member: MemberRelation;
  department: DepartmentRelation;
};

export type RoleCommandTarget = {
  employeeId: string;
  displayName: string;
  employeeNo: string;
  jobTitle: string;
  memberId: number;
  roleVersion: number;
};

export type ManagerCommandTarget = {
  employeeId: string;
  displayLabel: string;
  departmentPublicId: string;
  departmentName: string;
  currentManagerEmployeeId: string | null;
  managerVersion: number;
  managerSource: "unassigned" | "manual" | "directory";
};

export type ManagerCommandTargetsResult =
  | { status: "ready"; targets: ManagerCommandTarget[] }
  | { status: "unavailable" };

function memberRelation(value: MemberRelation) {
  return Array.isArray(value) ? value[0] : value;
}

function departmentRelation(value: DepartmentRelation) {
  return Array.isArray(value) ? value[0] : value;
}

function isTarget(row: RoleCommandTargetRow, organizationId: number): row is RoleCommandTargetRow & {
  organization_member_id: number;
  member: { id: number; role_version: number; status: "active" };
} {
  const member = memberRelation(row.member);
  return Boolean(
    row.public_id
    && row.display_name
    && row.employee_no
    && row.job_title
    && row.organization_id === organizationId
    && Number.isSafeInteger(row.organization_member_id)
    && row.organization_member_id! > 0
    && member
    && member.status === "active"
    && member.id === row.organization_member_id
    && Number.isSafeInteger(member.role_version)
    && member.role_version > 0,
  );
}

export async function loadRoleCommandTargets(
  session: WorkspaceSession,
  clientFactory: OrganizationCommandClientFactory = getSupabaseServerClient,
): Promise<RoleCommandTarget[]> {
  if (!session.permissionCodes.includes("role.manage")) return [];

  try {
    const client = await clientFactory();
    const organizationResponse = await client
      .from("organizations")
      .select("id")
      .eq("public_id", session.organization.id)
      .maybeSingle();
    const organization = organizationResponse.data as OrganizationRow | null;
    if (organizationResponse.error || !organization || !Number.isSafeInteger(organization.id) || organization.id <= 0) {
      return [];
    }

    const response = await client
      .from("employee_profiles")
      .select("public_id, display_name, employee_no, job_title, organization_id, organization_member_id, member:organization_members!employee_profiles_organization_member_id_fkey(id, role_version, status)")
      .eq("organization_id", organization.id)
      .is("deleted_at", null)
      .order("employee_no", { ascending: true });
    if (response.error) return [];

    return ((response.data ?? []) as RoleCommandTargetRow[])
      .filter((row) => isTarget(row, organization.id))
      .map((row) => ({
        employeeId: row.public_id,
        displayName: row.display_name,
        employeeNo: row.employee_no,
        jobTitle: row.job_title,
        memberId: row.organization_member_id,
        roleVersion: memberRelation(row.member)!.role_version,
      }));
  } catch {
    return [];
  }
}

function isManagerTargetRow(
  row: ManagerCommandTargetRow,
  organizationId: number,
): row is ManagerCommandTargetRow & {
  organization_member_id: number;
  department_id: number;
  member: { id: number; status: "active" };
  department: { id: number; name: string };
  manager_source: "unassigned" | "manual" | "directory";
} {
  const member = memberRelation(row.member);
  const department = departmentRelation(row.department);
  return Boolean(
    Number.isSafeInteger(row.id)
    && row.id > 0
    && row.public_id
    && row.display_name
    && row.employee_no
    && row.job_title
    && row.organization_id === organizationId
    && Number.isSafeInteger(row.organization_member_id)
    && row.organization_member_id! > 0
    && Number.isSafeInteger(row.department_id)
    && row.department_id! > 0
    && member
    && member.status === "active"
    && member.id === row.organization_member_id
    && department
    && department.id === row.department_id
    && department.organization_id === organizationId
    && department.public_id
    && department.name
    && Number.isSafeInteger(row.manager_version)
    && row.manager_version > 0
    && ["unassigned", "manual", "directory"].includes(row.manager_source)
    && (row.manager_employee_id === null
      || (Number.isSafeInteger(row.manager_employee_id) && row.manager_employee_id > 0)),
  );
}

export async function loadManagerCommandTargets(
  session: WorkspaceSession,
  clientFactory: OrganizationCommandClientFactory = getSupabaseServerClient,
): Promise<ManagerCommandTargetsResult> {
  if (!session.permissionCodes.includes("organization.manage")) {
    return { status: "ready", targets: [] };
  }

  try {
    const client = await clientFactory();
    const organizationResponse = await client
      .from("organizations")
      .select("id")
      .eq("public_id", session.organization.id)
      .maybeSingle();
    const organization = organizationResponse.data as OrganizationRow | null;
    if (
      organizationResponse.error
      || !organization
      || !Number.isSafeInteger(organization.id)
      || organization.id <= 0
    ) {
      return { status: "unavailable" };
    }

    const response = await client
      .from("employee_profiles")
      .select("id, public_id, display_name, employee_no, job_title, organization_id, organization_member_id, department_id, manager_employee_id, manager_version, manager_source, member:organization_members!employee_profiles_organization_member_id_fkey(id, status), department:departments!employee_profiles_tenant_department_fkey(id, public_id, organization_id, name)")
      .eq("organization_id", organization.id)
      .in("employment_status", ["probation", "active", "on_leave"])
      .is("deleted_at", null)
      .order("employee_no", { ascending: true });
    if (response.error) return { status: "unavailable" };

    const rows = ((response.data ?? []) as unknown as ManagerCommandTargetRow[])
      .filter((row) => isManagerTargetRow(row, organization.id));
    const publicIdByInternalId = new Map(
      rows.map((row) => [row.id, row.public_id]),
    );
    return {
      status: "ready",
      targets: rows.map((row) => {
        const department = departmentRelation(row.department)!;
        return {
          employeeId: row.public_id,
          displayLabel: `${row.display_name} · ${row.employee_no} · ${row.job_title}`,
          departmentPublicId: department.public_id,
          departmentName: department.name,
          currentManagerEmployeeId: row.manager_employee_id === null
            ? null
            : publicIdByInternalId.get(row.manager_employee_id) ?? null,
          managerVersion: row.manager_version,
          managerSource: row.manager_source as "unassigned" | "manual" | "directory",
        };
      }),
    };
  } catch {
    return { status: "unavailable" };
  }
}
