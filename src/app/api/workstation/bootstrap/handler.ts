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
    const [projectsResult, tasksResult, salaryResult] = await Promise.all([
      client.from("projects")
        .select("id, public_id, name, owner_member_id, status, health, progress, priority, updated_at")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
      client.from("tasks")
        .select("public_id, project_id, title, description, assignee_member_id, reporter_member_id, status, priority, start_date, due_date, progress, acceptance_criteria, blocker, review_note, next_step, result_summary, result_link, result_files")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
      client.from("salary")
        .select("payroll_month, base_salary, bonus, performance_bonus, project_bonus, other_bonus, social_security, individual_income_tax, other_deduction, deductions, net_salary, status, paid_at")
        .eq("employee_profile_id", employeeProfileId)
        .is("deleted_at", null)
        .order("payroll_month", { ascending: false }),
    ]);

    const failed = [projectsResult, tasksResult, salaryResult]
      .find((result) => result.error);
    if (failed?.error) throw failed.error;

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
          displayName: row.display_name,
          departmentName: relationName(row.department),
          jobTitle: row.job_title,
          skills: row.skills ?? [],
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
