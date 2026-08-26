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

export type RoleCommandTarget = {
  employeeId: string;
  displayName: string;
  employeeNo: string;
  jobTitle: string;
  memberId: number;
  roleVersion: number;
};

function memberRelation(value: MemberRelation) {
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
