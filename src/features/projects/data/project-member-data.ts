import type { MemberSummary, ProjectMemberRole } from "@/features/projects/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;

type OrganizationMemberRow = {
  id: number;
  public_id: string;
  user_id: string;
};

type DepartmentRelation = { name: string } | readonly { name: string }[] | null;

type EmployeeProfileRow = {
  organization_member_id: number;
  display_name: string;
  avatar_url: string | null;
  job_title: string;
  department: DepartmentRelation;
};

export type ProjectMemberDirectoryEntry = {
  summary: MemberSummary;
  userId: string;
};

function departmentName(relation: DepartmentRelation) {
  if (!relation) {
    return "未分配部门";
  }

  const department = Array.isArray(relation)
    ? relation[0]
    : relation as { name: string };

  return department?.name ?? "未分配部门";
}

export function fallbackProjectMember(
  memberId: number,
  role: ProjectMemberRole = "member",
): MemberSummary {
  const isOwner = role === "owner";

  return {
    id: String(memberId),
    displayName: isOwner ? "项目负责人" : "项目成员",
    department: "项目团队",
    title: isOwner ? "项目负责人" : "项目成员",
  };
}

export async function loadProjectMemberDirectory(
  client: SupabaseServerClient,
  memberIds: readonly number[],
) {
  const uniqueMemberIds = [...new Set(memberIds)];
  const directory = new Map<number, ProjectMemberDirectoryEntry>();

  if (uniqueMemberIds.length === 0) {
    return directory;
  }

  const [memberResponse, profileResponse] = await Promise.all([
    client
      .from("organization_members")
      .select("id, public_id, user_id")
      .in("id", uniqueMemberIds),
    client
      .from("employee_profiles")
      .select("organization_member_id, display_name, avatar_url, job_title, department:departments!employee_profiles_department_id_fkey(name)")
      .in("organization_member_id", uniqueMemberIds)
      .is("deleted_at", null),
  ]);

  if (memberResponse.error) {
    throw memberResponse.error;
  }
  if (profileResponse.error) {
    throw profileResponse.error;
  }

  const profiles = new Map(
    ((profileResponse.data ?? []) as EmployeeProfileRow[]).map((profile) => [
      profile.organization_member_id,
      profile,
    ]),
  );

  for (const member of (memberResponse.data ?? []) as OrganizationMemberRow[]) {
    const profile = profiles.get(member.id);
    directory.set(member.id, {
      userId: member.user_id,
      summary: profile
        ? {
          id: member.public_id,
          displayName: profile.display_name,
          department: departmentName(profile.department),
          title: profile.job_title,
          avatarUrl: profile.avatar_url ?? undefined,
        }
        : {
          ...fallbackProjectMember(member.id),
          id: member.public_id,
        },
    });
  }

  return directory;
}
