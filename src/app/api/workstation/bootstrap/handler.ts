import { NextResponse } from "next/server";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { buildServerBootstrap } from "@/features/workstation/server-bootstrap";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type BootstrapSession = Awaited<ReturnType<typeof getWorkspaceSession>>;

export type WorkstationBootstrapDependencies = {
  loadSession: () => Promise<BootstrapSession | { member: { id: number } } | null>;
  loadBootstrap: (session: NonNullable<BootstrapSession>) => Promise<unknown>;
};

function relationName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value;
  return typeof relation === "object" && relation !== null
    && typeof (relation as { name?: unknown }).name === "string"
    ? (relation as { name: string }).name
    : "未分配部门";
}

export function numericProfileIdForMember(
  rows: readonly { id: unknown; organization_member_id: unknown }[],
  memberId: number,
) {
  const profile = rows.find((row) => row.organization_member_id === memberId);
  if (!profile || !Number.isSafeInteger(profile.id) || Number(profile.id) <= 0) {
    throw new Error("employee_profile_not_found");
  }
  return Number(profile.id);
}

export const defaultWorkstationBootstrapDependencies: WorkstationBootstrapDependencies = {
  loadSession: getWorkspaceSession,
  async loadBootstrap(session) {
    const client = await getSupabaseServerClient();
    const membersResult = await client.from("employee_profiles")
      .select("id, organization_member_id, display_name, job_title, skills, department:departments!employee_profiles_department_id_fkey(name)")
      .is("deleted_at", null)
      .in("employment_status", ["probation", "active", "on_leave"])
      .order("display_name");
    if (membersResult.error) throw membersResult.error;

    const employeeProfileId = numericProfileIdForMember(
      membersResult.data ?? [],
      session.member.id,
    );
    const [
      projectsResult,
      tasksResult,
      salaryResult,
      notificationsResult,
      workProfilesResult,
      employeeSkillsResult,
    ] = await Promise.all([
      client.from("projects")
        .select("id, public_id, name, owner_member_id, status, health, progress, priority, updated_at")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
      client.from("tasks")
        .select("id, public_id, project_id, title, description, assignee_member_id, reporter_member_id, status, priority, start_date, due_date, progress, acceptance_criteria, blocker, review_note, next_step, result_summary, result_link, result_files, accepted_at, submitted_at, reviewed_at, submission_count, rejection_count")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
      client.from("salary")
        .select("payroll_month, base_salary, bonus, performance_bonus, project_bonus, other_bonus, social_security, individual_income_tax, other_deduction, deductions, net_salary, status, paid_at")
        .eq("employee_profile_id", employeeProfileId)
        .is("deleted_at", null)
        .order("payroll_month", { ascending: false }),
      client.from("task_notifications")
        .select("task_id, status, last_error_code"),
      client.from("employee_work_profiles")
        .select("employee_profile_id, summary, preferred_task_types, growth_goals, weekly_capacity_hours, self_skills, updated_at"),
      client.from("employee_skills")
        .select("employee_profile_id, proficiency_level, years_experience, verification_status, skill:skill_tags(name)"),
    ]);

    const failed = [
      projectsResult,
      tasksResult,
      salaryResult,
      notificationsResult,
      workProfilesResult,
      employeeSkillsResult,
    ]
      .find((result) => result.error);
    if (failed?.error) throw failed.error;

    const notificationByTask = new Map(
      (notificationsResult.data ?? []).map((row) => [row.task_id, {
        status: row.status,
        errorCode: row.last_error_code ?? "",
      }]),
    );
    const workProfileByEmployee = new Map(
      (workProfilesResult.data ?? []).map((row) => [row.employee_profile_id, {
        summary: row.summary,
        preferredTaskTypes: row.preferred_task_types ?? [],
        growthGoals: row.growth_goals ?? [],
        weeklyCapacityHours: Number(row.weekly_capacity_hours),
        selfSkills: Array.isArray(row.self_skills)
          ? row.self_skills.flatMap((skill) => (
            skill && typeof skill === "object"
              && typeof (skill as { name?: unknown }).name === "string"
              && Number.isInteger((skill as { level?: unknown }).level)
              ? [{
                name: (skill as { name: string }).name,
                level: Number((skill as { level: number }).level),
              }]
              : []
          ))
          : [],
        updatedAt: row.updated_at,
      }]),
    );
    const verifiedSkillsByEmployee = new Map<number, Array<{
      name: string;
      level: number | null;
      yearsExperience: number | null;
      verified: boolean;
    }>>();
    for (const row of employeeSkillsResult.data ?? []) {
      const name = relationName(row.skill);
      if (!name || name === "未分配部门") continue;
      const rows = verifiedSkillsByEmployee.get(row.employee_profile_id) ?? [];
      rows.push({
        name,
        level: row.proficiency_level === null ? null : Number(row.proficiency_level),
        yearsExperience: row.years_experience === null ? null : Number(row.years_experience),
        verified: row.verification_status === "verified",
      });
      verifiedSkillsByEmployee.set(row.employee_profile_id, rows);
    }

    return buildServerBootstrap(
      {
        memberId: session.member.id,
        displayName: session.profile.displayName,
        departmentName: session.profile.departmentName,
        jobTitle: session.profile.jobTitle,
        avatarUrl: session.profile.avatarUrl,
        permissionCodes: session.permissionCodes,
      },
      {
        members: (membersResult.data ?? []).map((row) => ({
          id: row.organization_member_id,
          profileId: row.id,
          displayName: row.display_name,
          departmentName: relationName(row.department),
          jobTitle: row.job_title,
          skills: row.skills ?? [],
          verifiedSkills: verifiedSkillsByEmployee.get(row.id) ?? [],
          workProfile: workProfileByEmployee.get(row.id) ?? null,
        })),
        projects: (projectsResult.data ?? []).map((row) => ({
          id: row.id,
          publicId: row.public_id,
          name: row.name,
          ownerMemberId: row.owner_member_id,
          status: row.status,
          health: row.health,
          progress: Number(row.progress),
          priority: row.priority,
          updatedAt: row.updated_at,
        })),
        tasks: (tasksResult.data ?? []).map((row) => ({
          publicId: row.public_id,
          projectId: row.project_id,
          title: row.title,
          description: row.description,
          assigneeMemberId: row.assignee_member_id,
          reporterMemberId: row.reporter_member_id,
          status: row.status,
          priority: row.priority,
          startDate: row.start_date,
          dueDate: row.due_date,
          progress: Number(row.progress),
          acceptanceCriteria: row.acceptance_criteria,
          blocker: row.blocker,
          reviewNote: row.review_note,
          nextStep: row.next_step,
          resultSummary: row.result_summary,
          resultLink: row.result_link,
          resultFiles: Array.isArray(row.result_files)
            ? row.result_files.filter((item): item is string => typeof item === "string")
            : [],
          acceptedAt: row.accepted_at,
          submittedAt: row.submitted_at,
          reviewedAt: row.reviewed_at,
          submissionCount: Number(row.submission_count ?? 0),
          rejectionCount: Number(row.rejection_count ?? 0),
          notification: notificationByTask.get(row.id) ?? {
            status: "unavailable",
            errorCode: "recipient_unavailable",
          },
        })),
        salary: (salaryResult.data ?? []).map((row) => ({
          payrollMonth: row.payroll_month,
          baseSalary: Number(row.base_salary),
          bonus: Number(row.bonus),
          performanceBonus: Number(row.performance_bonus),
          projectBonus: Number(row.project_bonus),
          otherBonus: Number(row.other_bonus),
          socialSecurity: Number(row.social_security),
          individualIncomeTax: Number(row.individual_income_tax),
          otherDeduction: Number(row.other_deduction),
          deductions: Number(row.deductions),
          netSalary: Number(row.net_salary),
          status: row.status,
          paidAt: row.paid_at,
        })),
      },
    );
  },
};

export function createWorkstationBootstrapHandler(
  dependencies: WorkstationBootstrapDependencies,
) {
  return async function loadBootstrap() {
    const session = await dependencies.loadSession();
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    try {
      return NextResponse.json(
        await dependencies.loadBootstrap(session as NonNullable<BootstrapSession>),
        { headers: { "cache-control": "no-store" } },
      );
    } catch {
      return NextResponse.json(
        { error: "workstation_unavailable" },
        { status: 500 },
      );
    }
  };
}
