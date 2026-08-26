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

export function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrNull(value: unknown) {
  return parseNullableNumber(value);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
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

type BootstrapQueryResult = {
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

export type SalaryPolicy = {
  publicId: string;
  departmentId: number | null;
  jobFamily: string;
  salaryGradeCode: string;
  jobLevel: number;
  baseSalary: number;
  salaryBandMin: number;
  salaryBandMax: number;
  performanceWeight: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type MatchSalaryPolicyInput = {
  policies: readonly SalaryPolicy[];
  departmentId: number | null;
  jobFamily: string | null;
  gradeCode: string | null;
  jobLevel: number | null;
  effectiveOn: string;
};

export function matchSalaryPolicy({
  policies,
  departmentId,
  jobFamily,
  gradeCode,
  jobLevel,
  effectiveOn,
}: MatchSalaryPolicyInput): SalaryPolicy | null {
  if (!jobFamily || !gradeCode || jobLevel === null || jobLevel < 1 || jobLevel > 20
    || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) {
    return null;
  }
  return policies
    .filter((policy) =>
      policy.jobFamily === jobFamily
      && policy.salaryGradeCode === gradeCode
      && policy.jobLevel === jobLevel
      && policy.effectiveFrom <= effectiveOn
      && (!policy.effectiveTo || policy.effectiveTo >= effectiveOn)
      && (policy.departmentId === departmentId || policy.departmentId === null),
    )
    .sort((left, right) => {
      const leftDepartmentMatch = left.departmentId === departmentId ? 1 : 0;
      const rightDepartmentMatch = right.departmentId === departmentId ? 1 : 0;
      if (leftDepartmentMatch !== rightDepartmentMatch) {
        return rightDepartmentMatch - leftDepartmentMatch;
      }
      return right.effectiveFrom.localeCompare(left.effectiveFrom)
        || left.publicId.localeCompare(right.publicId);
    })[0] ?? null;
}

function isMissingSalaryCalculationColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  const text = `${String(candidate.message ?? "")} ${String(candidate.details ?? "")}`;
  return candidate.code === "42703"
    || (/column/i.test(text) && /calculation_version|gross_salary|housing_fund_base|manual_adjustment_reason/i.test(text));
}

function errorSummary(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const candidate = error as {
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    message?: unknown;
    name?: unknown;
  };
  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    message: typeof candidate.message === "string"
      ? candidate.message
      : String(error),
    details: typeof candidate.details === "string" ? candidate.details : undefined,
    hint: typeof candidate.hint === "string" ? candidate.hint : undefined,
  };
}

function bootstrapQueryError(queryName: string, error: unknown) {
  const summary = errorSummary(error);
  const wrapped = new Error(
    `workstation_bootstrap_query_failed:${queryName}:${summary.message}`,
  );
  return Object.assign(wrapped, {
    cause: error,
    queryName,
    summary,
  });
}

function logBootstrapError(event: string, details: Record<string, unknown>) {
  console.error(event, details);
}

function logOptionalQueryFailure(queryName: string, error: unknown) {
  console.warn("workstation_bootstrap_optional_query_failed", {
    query: queryName,
    ...errorSummary(error),
  });
}

async function optionalBootstrapQuery<T extends BootstrapQueryResult>(
  queryName: string,
  query: PromiseLike<T>,
): Promise<T> {
  try {
    const result = await query;
    if (!result.error) return result;
    logOptionalQueryFailure(queryName, result.error);
    return { ...result, data: [], error: null } as T;
  } catch (error) {
    logOptionalQueryFailure(queryName, error);
    return { data: [], error: null } as unknown as T;
  }
}

function normalizeSalaryGradePolicies(
  rows: readonly Record<string, unknown>[],
): SalaryPolicy[] {
  return rows.flatMap((row) => {
    const publicId = stringOrNull(row.public_id);
    const jobFamily = stringOrNull(row.job_family);
    const salaryGradeCode = stringOrNull(row.salary_grade_code);
    const jobLevel = numberOrNull(row.job_level);
    const baseSalary = numberOrNull(row.base_salary);
    const salaryBandMin = numberOrNull(row.salary_band_min);
    const salaryBandMax = numberOrNull(row.salary_band_max);
    const performanceWeight = numberOrNull(row.performance_weight);
    const effectiveFrom = stringOrNull(row.effective_from);
    if (!publicId || !jobFamily || !salaryGradeCode || jobLevel === null
      || jobLevel < 1 || jobLevel > 20
      || baseSalary === null || salaryBandMin === null || salaryBandMax === null
      || performanceWeight === null || !effectiveFrom) {
      return [];
    }
    return [{
      publicId,
      departmentId: numberOrNull(row.department_id),
      jobFamily,
      salaryGradeCode,
      jobLevel,
      baseSalary,
      salaryBandMin,
      salaryBandMax,
      performanceWeight,
      effectiveFrom,
      effectiveTo: stringOrNull(row.effective_to),
    }];
  });
}

function salaryPolicyForMember(
  member: Record<string, unknown>,
  policies: readonly SalaryPolicy[],
  positionJobFamilyById: ReadonlyMap<number, string>,
  effectiveOn: string,
) {
  const salaryGradeCode = stringOrNull(member.salary_grade_code);
  const jobLevel = numberOrNull(member.job_level);
  const departmentId = numberOrNull(member.department_id);
  const positionTemplateId = numberOrNull(member.position_template_id);
  const jobFamily = positionTemplateId === null
    ? null
    : positionJobFamilyById.get(positionTemplateId) ?? null;
  const policy = matchSalaryPolicy({
    policies,
    departmentId,
    jobFamily,
    gradeCode: salaryGradeCode,
    jobLevel,
    effectiveOn,
  });

  if (!policy) return null;
  return {
    publicId: policy.publicId,
    baseSalary: policy.baseSalary,
    salaryBandMin: policy.salaryBandMin,
    salaryBandMax: policy.salaryBandMax,
    performanceWeight: policy.performanceWeight,
    effectiveFrom: policy.effectiveFrom,
    effectiveTo: policy.effectiveTo,
    matchedDepartment: policy.departmentId === departmentId,
  };
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
    const canManageSalary = session.permissionCodes.includes("salary.manage");
    const membersResult = await client.from("employee_profiles")
      .select("id, organization_member_id, display_name, job_title, department_id, position_template_id, salary_grade_code, job_level, skills, department:departments!employee_profiles_department_id_fkey(name)")
      .is("deleted_at", null)
      .in("employment_status", ["probation", "active", "on_leave"])
      .order("display_name");
    if (membersResult.error) {
      throw bootstrapQueryError("employee_profiles", membersResult.error);
    }

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
      departmentsResult,
      salaryGradePoliciesResult,
      positionTemplatesResult,
      selfSalaryPolicyResult,
      workProfilesResult,
      employeeSkillsResult,
      agentsResult,
      agentPermissionsResult,
      agentInvocationsResult,
      knowledgeResult,
    ] = await Promise.all([
      optionalBootstrapQuery("projects", client.from("projects")
        .select("id, public_id, name, owner_member_id, status, health, progress, priority, updated_at")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })),
      optionalBootstrapQuery("tasks", client.from("tasks")
        .select("id, public_id, project_id, title, description, assignee_member_id, reporter_member_id, status, priority, start_date, due_date, progress, acceptance_criteria, blocker, review_note, next_step, result_summary, result_link, result_files, accepted_at, submitted_at, reviewed_at, submission_count, rejection_count")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })),
      optionalBootstrapQuery("salary", loadSalaryRows(
        client as unknown as SalaryClient,
        employeeProfileId,
      )),
      optionalBootstrapQuery("task_notifications", client.from("task_notifications")
        .select("task_id, status, last_error_code")),
      optionalBootstrapQuery("departments", client.from("departments")
        .select("id, name")
        .is("deleted_at", null)),
      canManageSalary
        ? optionalBootstrapQuery("salary_grade_policies", client.from("salary_grade_policies")
          .select("public_id, department_id, job_family, salary_grade_code, job_level, base_salary, salary_band_min, salary_band_max, performance_weight, effective_from, effective_to")
          .eq("status", "active")
          .is("deleted_at", null)
          .order("effective_from", { ascending: false }))
        : Promise.resolve({ data: [], error: null }),
      canManageSalary
        ? optionalBootstrapQuery("position_templates", client.from("position_templates")
          .select("id, category")
          .eq("status", "active")
          .is("deleted_at", null))
        : Promise.resolve({ data: [], error: null }),
      canManageSalary
        ? Promise.resolve({ data: [], error: null })
        : optionalBootstrapQuery("current_salary_grade_policy", client.rpc(
          "current_salary_grade_policy",
        )),
      accessibleEmployeeProfileIds.length
        ? optionalBootstrapQuery("employee_work_profiles", serviceClient.from("employee_work_profiles")
          .select("employee_profile_id, summary, preferred_task_types, growth_goals, weekly_capacity_hours, self_skills, updated_at")
          .in("employee_profile_id", accessibleEmployeeProfileIds))
        : Promise.resolve({ data: [], error: null }),
      optionalBootstrapQuery("employee_skills", client.from("employee_skills")
        .select("employee_profile_id, proficiency_level, years_experience, verification_status, skill:skill_tags(name)")),
      optionalBootstrapQuery("agent_definitions", client.from("agent_definitions")
        .select("id, public_id, name, icon, description, model_code, prompt_version, capabilities, visibility_scope, min_job_level, status, department_id")
        .is("deleted_at", null)
        .in("status", ["enabled", "disabled"])
        .order("updated_at", { ascending: false })),
      optionalBootstrapQuery("agent_permissions", client.from("agent_permissions")
        .select("agent_id, scope_type, min_job_level, department_id, member_id")
        .is("deleted_at", null)),
      optionalBootstrapQuery("agent_invocations", client.from("agent_invocations")
        .select("agent_id, actor_member_id, status, latency_ms, output_summary, started_at")
        .order("started_at", { ascending: false })
        .limit(40)),
      optionalBootstrapQuery("knowledge_documents", client.from("knowledge_documents")
        .select("public_id, title, summary, category, tags, version, published_at")
        .eq("status", "published")
        .order("updated_at", { ascending: false })
        .limit(30)),
    ]);

    const notificationByTask = new Map(
      (notificationsResult.data ?? []).map((row) => [row.task_id, {
        status: row.status,
        errorCode: row.last_error_code ?? "",
      }]),
    );
    const departmentNameById = new Map(
      (departmentsResult.data ?? []).flatMap((row) => {
        const id = Number(row.id);
        return Number.isSafeInteger(id) && typeof row.name === "string"
          ? [[id, row.name] as const]
          : [];
      }),
    );
    const salaryGradePolicies = normalizeSalaryGradePolicies(
      salaryGradePoliciesResult.data ?? [],
    );
    const positionJobFamilyById = new Map(
      (positionTemplatesResult.data ?? []).flatMap((row) => {
        const id = numberOrNull(row.id);
        const category = stringOrNull(row.category);
        return id !== null && category ? [[id, category] as const] : [];
      }),
    );
    const selfSalaryPolicy = normalizeSalaryGradePolicies(
      selfSalaryPolicyResult.data ?? [],
    )[0] ?? null;
    const effectiveOn = new Date().toISOString().slice(0, 10);
    const memberNameByMemberId = new Map(
      (membersResult.data ?? []).flatMap((row) => (
        Number.isSafeInteger(row.organization_member_id)
          && typeof row.display_name === "string"
          ? [[Number(row.organization_member_id), row.display_name] as const]
          : []
      )),
    );
    const agentMetaById = new Map(
      (agentsResult.data ?? []).flatMap((row) => {
        const id = Number(row.id);
        if (!Number.isSafeInteger(id)) return [];
        const departmentId = row.department_id === null
          ? null
          : Number(row.department_id);
        return [[id, {
          name: typeof row.name === "string" ? row.name : "未知 Agent",
          departmentName: departmentId !== null && Number.isSafeInteger(departmentId)
            ? departmentNameById.get(departmentId) ?? null
            : null,
        }] as const];
      }),
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
        const departmentId = Number(row.department_id);
        const departmentName = Number.isSafeInteger(departmentId)
          ? departmentNameById.get(departmentId)
          : null;
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
          departmentId: numberOrNull(row.department_id),
          displayName: row.display_name,
          departmentName: relationName(row.department),
          jobTitle: row.job_title,
          salaryGradeCode: row.salary_grade_code,
          jobLevel: row.job_level == null ? null : Number(row.job_level),
          skills: row.skills ?? [],
          verifiedSkills: verifiedSkillsByEmployee.get(row.id) ?? [],
          workProfile: workProfileByEmployee.get(row.id) ?? null,
          salaryPolicy: canManageSalary
            ? salaryPolicyForMember(
              row,
              salaryGradePolicies,
              positionJobFamilyById,
              effectiveOn,
            )
            : row.organization_member_id === session.member.id
              ? selfSalaryPolicy && {
                publicId: selfSalaryPolicy.publicId,
                baseSalary: selfSalaryPolicy.baseSalary,
                salaryBandMin: selfSalaryPolicy.salaryBandMin,
                salaryBandMax: selfSalaryPolicy.salaryBandMax,
                performanceWeight: selfSalaryPolicy.performanceWeight,
                effectiveFrom: selfSalaryPolicy.effectiveFrom,
                effectiveTo: selfSalaryPolicy.effectiveTo,
                matchedDepartment: selfSalaryPolicy.departmentId !== null,
               }
               : null,
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
            departmentName: agentMetaById.get(Number(row.id))?.departmentName ?? null,
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
          agentName: agentMetaById.get(Number(row.agent_id))?.name ?? "未知 Agent",
          departmentName: agentMetaById.get(Number(row.agent_id))?.departmentName ?? null,
          actorMemberId: Number.isSafeInteger(row.actor_member_id)
            ? Number(row.actor_member_id)
            : null,
          actorName: Number.isSafeInteger(row.actor_member_id)
            ? memberNameByMemberId.get(Number(row.actor_member_id)) ?? null
            : null,
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
    } catch (error) {
      logBootstrapError("workstation_bootstrap_failed", errorSummary(error));
      return NextResponse.json(
        { error: "workstation_unavailable" },
        { status: 500 },
      );
    }
  };
}
