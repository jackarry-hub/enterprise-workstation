import { NextResponse } from "next/server";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { buildServerBootstrap } from "@/features/workstation/server-bootstrap";
import {
  getSupabaseServerClient,
  getSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

type BootstrapSession = Awaited<ReturnType<typeof getWorkspaceSession>>;

const DETAILED_SALARY_SELECT = "payroll_month, base_salary, bonus, performance_bonus, project_bonus, other_bonus, other_income, gross_salary, social_base, housing_fund_base, pension_employee, medical_employee, unemployment_employee, housing_fund_employee, social_security, tax_exempt_income, special_additional_deduction, other_statutory_deduction, tax_relief, cumulative_taxable_income, individual_income_tax, other_deduction, manual_adjustment_reason, deductions, net_salary, calculation_version, status, paid_at";
const LEGACY_SALARY_SELECT = "payroll_month, base_salary, bonus, social_security, individual_income_tax, other_deduction, deductions, net_salary, status, paid_at";

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

function optionalRelationName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value;
  return typeof relation === "object" && relation !== null
    && typeof (relation as { name?: unknown }).name === "string"
    ? (relation as { name: string }).name
    : null;
}

function nestedAgentName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value;
  return typeof relation === "object" && relation !== null
    && typeof (relation as { name?: unknown }).name === "string"
    ? (relation as { name: string }).name
    : "未知 Agent";
}

function actorName(value: unknown) {
  const actor = Array.isArray(value) ? value[0] : value;
  if (typeof actor !== "object" || actor === null) return null;
  const profile = Array.isArray((actor as { profile?: unknown }).profile)
    ? (actor as { profile?: unknown[] }).profile?.[0]
    : (actor as { profile?: unknown }).profile;
  if (typeof profile === "object" && profile !== null
    && typeof (profile as { display_name?: unknown }).display_name === "string") {
    return (profile as { display_name: string }).display_name;
  }
  return null;
}

function actorMemberId(value: unknown) {
  const actor = Array.isArray(value) ? value[0] : value;
  return typeof actor === "object" && actor !== null
    && Number.isSafeInteger((actor as { id?: unknown }).id)
    ? Number((actor as { id: number }).id)
    : null;
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

type SalaryQueryResult = {
  data: readonly Record<string, unknown>[] | null;
  error: unknown;
};

type SalaryQueryBuilder = {
  eq: (column: string, value: unknown) => SalaryQueryBuilder;
  is: (column: string, value: unknown) => SalaryQueryBuilder;
  order: (column: string, options: { ascending: boolean }) => PromiseLike<SalaryQueryResult>;
};

type SalaryClient = {
  from: (table: string) => {
    select: (columns: string) => SalaryQueryBuilder;
  };
};

function isMissingSalaryCalculationColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  const text = `${String(candidate.message ?? "")} ${String(candidate.details ?? "")}`;
  return candidate.code === "42703"
    || (/column/i.test(text) && /calculation_version|gross_salary|housing_fund_base|manual_adjustment_reason/i.test(text));
}

async function loadSalaryRows(
  client: SalaryClient,
  employeeProfileId: number,
): Promise<SalaryQueryResult> {
  const detailedResult = await client.from("salary")
    .select(DETAILED_SALARY_SELECT)
    .eq("employee_profile_id", employeeProfileId)
    .is("deleted_at", null)
    .order("payroll_month", { ascending: false });

  if (!detailedResult.error || !isMissingSalaryCalculationColumn(detailedResult.error)) {
    return detailedResult;
  }

  return client.from("salary")
    .select(LEGACY_SALARY_SELECT)
    .eq("employee_profile_id", employeeProfileId)
    .is("deleted_at", null)
    .order("payroll_month", { ascending: false });
}

export const defaultWorkstationBootstrapDependencies: WorkstationBootstrapDependencies = {
  loadSession: getWorkspaceSession,
  async loadBootstrap(session) {
    const client = await getSupabaseServerClient();
    const membersResult = await client.from("employee_profiles")
      .select("id, organization_member_id, display_name, job_title, salary_grade_code, job_level, skills, department:departments!employee_profiles_department_id_fkey(name)")
      .is("deleted_at", null)
      .in("employment_status", ["probation", "active", "on_leave"])
      .order("display_name");
    if (membersResult.error) throw membersResult.error;

    const employeeProfileId = numericProfileIdForMember(
      membersResult.data ?? [],
      session.member.id,
    );
    const accessibleEmployeeProfileIds = (membersResult.data ?? [])
      .map((row) => Number(row.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    const serviceClient = getSupabaseServiceRoleClient();
    const [
      projectsResult,
      tasksResult,
      salaryResult,
      notificationsResult,
      workProfilesResult,
      employeeSkillsResult,
      agentsResult,
      agentPermissionsResult,
      agentInvocationsResult,
      knowledgeResult,
    ] = await Promise.all([
      client.from("projects")
        .select("id, public_id, name, owner_member_id, status, health, progress, priority, updated_at")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
      client.from("tasks")
        .select("id, public_id, project_id, title, description, assignee_member_id, reporter_member_id, status, priority, start_date, due_date, progress, acceptance_criteria, blocker, review_note, next_step, result_summary, result_link, result_files, accepted_at, submitted_at, reviewed_at, submission_count, rejection_count")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
      loadSalaryRows(client as unknown as SalaryClient, employeeProfileId),
      client.from("task_notifications")
        .select("task_id, status, last_error_code"),
      accessibleEmployeeProfileIds.length
        ? serviceClient.from("employee_work_profiles")
          .select("employee_profile_id, summary, preferred_task_types, growth_goals, weekly_capacity_hours, self_skills, updated_at")
          .in("employee_profile_id", accessibleEmployeeProfileIds)
        : Promise.resolve({ data: [], error: null }),
      client.from("employee_skills")
        .select("employee_profile_id, proficiency_level, years_experience, verification_status, skill:skill_tags(name)"),
      client.from("agent_definitions")
        .select("id, public_id, name, icon, description, model_code, prompt_version, capabilities, visibility_scope, min_job_level, status, department:departments!agent_definitions_department_id_fkey(name)")
        .is("deleted_at", null)
        .in("status", ["enabled", "disabled"])
        .order("updated_at", { ascending: false }),
      client.from("agent_permissions")
        .select("agent_id, scope_type, min_job_level, department:departments!agent_permissions_department_id_fkey(name), member_id")
        .is("deleted_at", null),
      client.from("agent_invocations")
        .select("agent_id, status, latency_ms, output_summary, started_at, agent:agent_definitions!agent_invocations_agent_id_fkey(name, department:departments!agent_definitions_department_id_fkey(name)), actor:organization_members!agent_invocations_actor_member_id_fkey(id, profile:employee_profiles!employee_profiles_organization_member_id_fkey(display_name))")
        .order("started_at", { ascending: false })
        .limit(40),
      client.from("knowledge_documents")
        .select("public_id, title, summary, category, tags, version, published_at")
        .eq("status", "published")
        .order("updated_at", { ascending: false })
        .limit(30),
    ]);

    const failed = [
      projectsResult,
      tasksResult,
      salaryResult,
      notificationsResult,
      workProfilesResult,
      employeeSkillsResult,
      agentsResult,
      agentPermissionsResult,
      agentInvocationsResult,
      knowledgeResult,
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
    const permissionsByAgent = new Map<number, {
      scope: string;
      minJobLevel: number;
      departments: string[];
      memberIds: number[];
    }>();
    for (const row of agentPermissionsResult.data ?? []) {
      const previous = permissionsByAgent.get(row.agent_id) ?? {
        scope: "all",
        minJobLevel: Number(row.min_job_level ?? 1),
        departments: [],
        memberIds: [],
      };
      previous.minJobLevel = Math.min(previous.minJobLevel, Number(row.min_job_level ?? 1));
      if (row.scope_type === "dept") {
        previous.scope = previous.scope === "all" ? "dept" : "list";
        const departmentName = optionalRelationName(row.department);
        if (departmentName && !previous.departments.includes(departmentName)) {
          previous.departments.push(departmentName);
        }
      } else if (row.scope_type === "member") {
        if (Number.isSafeInteger(row.member_id) && Number(row.member_id) > 0) {
          previous.memberIds.push(Number(row.member_id));
        }
      } else if (row.scope_type === "role") {
        previous.scope = previous.scope === "all" ? "list" : previous.scope;
      } else {
        previous.scope = "all";
      }
      permissionsByAgent.set(row.agent_id, previous);
    }

    const invocationsByAgent = new Map<number, { total: number; succeeded: number }>();
    for (const row of agentInvocationsResult.data ?? []) {
      const current = invocationsByAgent.get(row.agent_id) ?? { total: 0, succeeded: 0 };
      current.total += 1;
      if (row.status === "succeeded") current.succeeded += 1;
      invocationsByAgent.set(row.agent_id, current);
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
          salaryGradeCode: row.salary_grade_code,
          jobLevel: row.job_level == null ? null : Number(row.job_level),
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
        salary: ((salaryResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
          payrollMonth: String(row.payroll_month),
          baseSalary: Number(row.base_salary),
          bonus: Number(row.bonus),
          performanceBonus: Number(row.performance_bonus),
          projectBonus: Number(row.project_bonus),
          otherBonus: Number(row.other_bonus),
          otherIncome: Number(row.other_income ?? 0),
          grossSalary: Number(row.gross_salary ?? 0),
          socialBase: Number(row.social_base ?? 0),
          housingFundBase: Number(row.housing_fund_base ?? 0),
          pensionEmployee: Number(row.pension_employee ?? 0),
          medicalEmployee: Number(row.medical_employee ?? 0),
          unemploymentEmployee: Number(row.unemployment_employee ?? 0),
          housingFundEmployee: Number(row.housing_fund_employee ?? 0),
          socialSecurity: Number(row.social_security),
          taxExemptIncome: Number(row.tax_exempt_income ?? 0),
          specialAdditionalDeduction: Number(
            row.special_additional_deduction ?? 0,
          ),
          otherStatutoryDeduction: Number(
            row.other_statutory_deduction ?? 0,
          ),
          taxRelief: Number(row.tax_relief ?? 0),
          cumulativeTaxableIncome: Number(row.cumulative_taxable_income ?? 0),
          individualIncomeTax: Number(row.individual_income_tax),
          otherDeduction: Number(row.other_deduction),
          manualAdjustmentReason: String(row.manual_adjustment_reason ?? ""),
          deductions: Number(row.deductions),
          netSalary: Number(row.net_salary),
          calculationVersion: row.calculation_version
            ? String(row.calculation_version)
            : null,
          status: String(row.status),
          paidAt: typeof row.paid_at === "string" ? row.paid_at : null,
        })),
        agents: (agentsResult.data ?? []).map((row) => {
          const permission = permissionsByAgent.get(row.id);
          const stats = invocationsByAgent.get(row.id);
          return {
            id: row.id,
            publicId: row.public_id,
            name: row.name,
            departmentName: optionalRelationName(row.department),
            icon: row.icon,
            description: row.description,
            modelCode: row.model_code,
            promptVersion: row.prompt_version,
            capabilities: Array.isArray(row.capabilities)
              ? row.capabilities.filter((item): item is string => typeof item === "string")
              : [],
            visibilityScope: permission?.scope ?? row.visibility_scope,
            minJobLevel: permission?.minJobLevel ?? Number(row.min_job_level),
            allowedDepartmentNames: permission?.departments ?? [],
            allowedMemberIds: permission?.memberIds ?? [],
            invocationCount: stats?.total ?? 0,
            successRate: stats?.total
              ? Math.round((stats.succeeded / stats.total) * 1000) / 10
              : 100,
            status: row.status,
          };
        }),
        agentInvocations: (agentInvocationsResult.data ?? []).map((row) => ({
          agentId: row.agent_id,
          agentName: nestedAgentName(row.agent),
          departmentName: typeof row.agent === "object" && row.agent !== null
            ? optionalRelationName((row.agent as { department?: unknown }).department)
            : null,
          actorMemberId: actorMemberId(row.actor),
          actorName: actorName(row.actor),
          status: row.status,
          latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
          outputSummary: row.output_summary,
          startedAt: row.started_at,
        })),
        knowledge: (knowledgeResult.data ?? []).map((row) => ({
          publicId: row.public_id,
          title: row.title,
          category: row.category,
          summary: row.summary,
          tags: Array.isArray(row.tags)
            ? row.tags.filter((item): item is string => typeof item === "string")
            : [],
          version: Number(row.version),
          publishedAt: row.published_at,
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
