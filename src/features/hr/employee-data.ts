import type {
  Department,
  EmployeeAgentRun,
  EmployeeCapabilityCenter,
  EmployeeCapabilityCenterResult,
  EmployeeCapabilityEvidence,
  EmployeeCapabilitySkill,
  EmployeeDirectoryItem,
  EmployeeDirectoryResult,
  EmployeePrivateProfile,
  EmployeePrivateProfileResult,
  EmployeeProfile,
  EmployeeWorkAssignment,
  EmployeeWorkProfile,
  EmploymentStatus,
  EmploymentType,
} from "@/features/hr/employee-types";
export { filterEmployees, getEmployeeDetail } from "@/features/hr/employee-selectors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type EmployeeDirectoryClientFactory = () => Promise<SupabaseServerClient>;

type RpcResponse = { data: unknown; error: unknown };
type RpcClient = {
  rpc: (name: string, parameters?: Record<string, unknown>) => Promise<RpcResponse>;
};

type JsonRecord = Record<string, unknown>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function string(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) return null;
  return value;
}

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown, maximumItems = 20) {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const parsed = value.map((item) => string(item, 120, true));
  return parsed.every((item): item is string => item !== null) ? parsed : null;
}

function parseWorkProfile(value: unknown): EmployeeWorkProfile | undefined {
  if (value == null) return undefined;
  const source = record(value);
  const summary = string(source?.summary, 240);
  const preferredTaskTypes = stringArray(source?.preferredTaskTypes, 8);
  const growthGoals = stringArray(source?.growthGoals, 8);
  const weeklyCapacityHours = finiteNumber(source?.weeklyCapacityHours);
  const updatedAt = timestamp(source?.updatedAt);
  const selfSkills = Array.isArray(source?.selfSkills) ? source.selfSkills.flatMap((item) => {
    const skill = record(item);
    const name = string(skill?.name, 40, true);
    const level = finiteNumber(skill?.level);
    return name && level !== null && level >= 1 && level <= 5 ? [{ name, level }] : [];
  }) : null;
  if (summary === null || !preferredTaskTypes || !growthGoals || weeklyCapacityHours === null
      || weeklyCapacityHours < 1 || weeklyCapacityHours > 80 || !updatedAt || !selfSkills
      || selfSkills.length !== (source?.selfSkills as unknown[])?.length) return undefined;
  return { summary, preferredTaskTypes, growthGoals, weeklyCapacityHours, selfSkills, updatedAt };
}

function parseSkills(value: unknown): EmployeeCapabilitySkill[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const items = value.flatMap((item) => {
    const source = record(item);
    const id = uuid(source?.id);
    const code = string(source?.code, 80, true);
    const name = string(source?.name, 120, true);
    const level = source?.level == null ? undefined : finiteNumber(source.level) ?? undefined;
    const yearsExperience = source?.yearsExperience == null ? undefined : finiteNumber(source.yearsExperience) ?? undefined;
    const skillSource = source?.source;
    const verificationStatus = source?.verificationStatus;
    const updatedAt = timestamp(source?.updatedAt);
    if (!id || !code || !name || (level !== undefined && (level < 1 || level > 5))
        || (yearsExperience !== undefined && (yearsExperience < 0 || yearsExperience > 80))
        || !["self", "manager", "import", "system"].includes(String(skillSource))
        || !["unverified", "verified"].includes(String(verificationStatus)) || !updatedAt) return [];
    return [{ id, code, name, level, yearsExperience,
      source: skillSource as EmployeeCapabilitySkill["source"],
      verificationStatus: verificationStatus as EmployeeCapabilitySkill["verificationStatus"], updatedAt }];
  });
  return items.length === value.length ? items : null;
}

function parseAssignments(value: unknown): EmployeeWorkAssignment[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const items = value.flatMap((item) => {
    const source = record(item);
    const id = uuid(source?.id); const projectId = uuid(source?.projectId);
    const title = string(source?.title, 500, true); const projectName = string(source?.projectName, 200, true);
    const status = string(source?.status, 40, true); const priority = string(source?.priority, 40, true);
    const progress = finiteNumber(source?.progress); const updatedAt = timestamp(source?.updatedAt);
    const dueDate = source?.dueDate == null ? undefined : string(source.dueDate, 10, true) ?? undefined;
    if (!id || !projectId || !title || !projectName || !status || !priority || progress === null
        || progress < 0 || progress > 100 || !updatedAt || (source?.dueDate != null && !dueDate)) return [];
    return [{ id, title, projectId, projectName, status, priority, progress, dueDate, updatedAt }];
  });
  return items.length === value.length ? items : null;
}

function parseEvidence(value: unknown): EmployeeCapabilityEvidence[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const items = value.flatMap((item) => {
    const source = record(item);
    const id = uuid(source?.id); const taskId = uuid(source?.taskId); const projectId = uuid(source?.projectId);
    const eventType = string(source?.eventType, 40, true); const taskTitle = string(source?.taskTitle, 500, true);
    const projectName = string(source?.projectName, 200, true); const occurredAt = timestamp(source?.occurredAt);
    const decision = source?.decision == null ? undefined : source.decision;
    const note = source?.note == null ? undefined : string(source.note, 8000) ?? undefined;
    if (!id || !taskId || !projectId || !eventType || !taskTitle || !projectName || !occurredAt
        || (decision !== undefined && !["pass", "reject"].includes(String(decision)))
        || (source?.note != null && note === undefined)) return [];
    return [{ id, eventType, taskId, taskTitle, projectId, projectName,
      decision: decision as EmployeeCapabilityEvidence["decision"], note, occurredAt }];
  });
  return items.length === value.length ? items : null;
}

function parseAgentRuns(value: unknown): EmployeeAgentRun[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const items = value.flatMap((item) => {
    const source = record(item);
    const id = uuid(source?.id); const agentId = uuid(source?.agentId);
    const agentName = string(source?.agentName, 120, true); const status = string(source?.status, 40, true);
    const inputSummary = string(source?.inputSummary, 8000); const outputSummary = string(source?.outputSummary, 8000);
    const modelCode = string(source?.modelCode, 120); const cost = finiteNumber(source?.cost);
    const latencyMs = source?.latencyMs == null ? undefined : finiteNumber(source.latencyMs) ?? undefined;
    const startedAt = timestamp(source?.startedAt);
    const completedAt = source?.completedAt == null ? undefined : timestamp(source.completedAt) ?? undefined;
    if (!id || !agentId || !agentName || !status || inputSummary === null || outputSummary === null
        || modelCode === null || cost === null || cost < 0 || !startedAt
        || (source?.latencyMs != null && latencyMs === undefined)
        || (source?.completedAt != null && completedAt === undefined)) return [];
    return [{ id, agentId, agentName, status, inputSummary, outputSummary, modelCode,
      cost, latencyMs, startedAt, completedAt }];
  });
  return items.length === value.length ? items : null;
}

export function parseEmployeeCapabilityCenter(value: unknown): EmployeeCapabilityCenter | null {
  const source = record(value);
  if (!source || typeof source.canViewWork !== "boolean" || typeof source.canViewAgent !== "boolean") return null;
  const skills = parseSkills(source.skills); const assignments = parseAssignments(source.assignments);
  const evidence = parseEvidence(source.evidence); const agentRuns = parseAgentRuns(source.agentRuns);
  const workProfile = parseWorkProfile(source.workProfile);
  if (!skills || !assignments || !evidence || !agentRuns || (source.workProfile != null && !workProfile)) return null;
  let workload: EmployeeCapabilityCenter["workload"];
  if (source.workload != null) {
    const value = record(source.workload);
    const openTasks = finiteNumber(value?.openTasks); const inProgressTasks = finiteNumber(value?.inProgressTasks);
    const awaitingReviewTasks = finiteNumber(value?.awaitingReviewTasks); const completedTasks = finiteNumber(value?.completedTasks);
    if ([openTasks, inProgressTasks, awaitingReviewTasks, completedTasks].some((count) => count === null || count < 0)) return null;
    workload = { openTasks: openTasks!, inProgressTasks: inProgressTasks!,
      awaitingReviewTasks: awaitingReviewTasks!, completedTasks: completedTasks! };
  }
  return { canViewWork: source.canViewWork, canViewAgent: source.canViewAgent,
    workProfile, skills, workload, assignments, evidence, agentRuns };
}

type EmployeeDirectoryRpcRow = {
  employee_public_id: string;
  employee_no: string;
  display_name: string;
  avatar_url: string | null;
  department_public_id: string | null;
  department_code: string | null;
  department_name: string | null;
  department_status: Department["status"] | null;
  department_sort_order: number | null;
  job_title: string;
  manager_employee_public_id: string | null;
  manager_display_name: string | null;
  employment_type: EmploymentType;
  employment_status: EmploymentStatus;
};

type EmployeePrivateProfileRpcRow = {
  employee_public_id: string;
  private_email: string | null;
  phone: string | null;
  hire_date: string | null;
  departure_date: string | null;
  sensitive_hr_notes: string | null;
};

function getStats(employees: EmployeeDirectoryItem[], departments: Department[]) {
  return {
    total: employees.length,
    active: employees.filter(({ profile }) => profile.employmentStatus === "active").length,
    probation: employees.filter(({ profile }) => profile.employmentStatus === "probation").length,
    departments: departments.filter(({ status }) => status === "active").length,
  };
}

function emptySupabaseResult(loadError?: string): EmployeeDirectoryResult {
  return {
    source: "supabase",
    data: {
      employees: [],
      departments: [],
      stats: { total: 0, active: 0, probation: 0, departments: 0 },
      loadError,
    },
  };
}

function toDirectoryRows(data: unknown): EmployeeDirectoryRpcRow[] {
  return Array.isArray(data) ? data as EmployeeDirectoryRpcRow[] : [];
}

function toPrivateProfile(data: unknown): EmployeePrivateProfile | undefined {
  const row = Array.isArray(data) ? data[0] as EmployeePrivateProfileRpcRow | undefined : undefined;
  if (!row?.employee_public_id) return undefined;

  return {
    employeePublicId: row.employee_public_id,
    privateEmail: row.private_email ?? undefined,
    phone: row.phone ?? undefined,
    hireDate: row.hire_date ?? undefined,
    departureDate: row.departure_date ?? undefined,
    sensitiveHrNotes: row.sensitive_hr_notes ?? undefined,
  };
}

function directoryFromRows(rows: EmployeeDirectoryRpcRow[]): EmployeeDirectoryResult {
  const departmentsById = new Map<string, Department>();
  rows.forEach((row) => {
    if (
      row.department_public_id
      && row.department_code
      && row.department_name
      && row.department_status
      && row.department_sort_order !== null
    ) {
      departmentsById.set(row.department_public_id, {
        id: row.department_public_id,
        code: row.department_code,
        name: row.department_name,
        status: row.department_status,
        sortOrder: row.department_sort_order,
      });
    }
  });
  const departments = [...departmentsById.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code));
  const departmentById = new Map(departments.map((department) => [department.id, department]));

  const employees: EmployeeDirectoryItem[] = rows.map((row) => {
    const profile: EmployeeProfile = {
      id: row.employee_public_id,
      employeeNo: row.employee_no,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      departmentId: row.department_public_id ?? undefined,
      jobTitle: row.job_title,
      managerEmployeeId: row.manager_employee_public_id ?? undefined,
      employmentType: row.employment_type,
      employmentStatus: row.employment_status,
    };

    return {
      profile,
      department: profile.departmentId ? departmentById.get(profile.departmentId) : undefined,
      manager: row.manager_employee_public_id && row.manager_display_name
        ? {
          id: row.manager_employee_public_id,
          displayName: row.manager_display_name,
        }
        : undefined,
    };
  });

  return {
    source: "supabase",
    data: { employees, departments, stats: getStats(employees, departments) },
  };
}

export async function loadEmployeeDirectory(
  organizationPublicId: string,
  clientFactory: EmployeeDirectoryClientFactory = getSupabaseServerClient,
  _options: { allowMockFallback?: boolean } = {},
): Promise<EmployeeDirectoryResult> {
  void _options;
  try {
    const client = await clientFactory() as unknown as RpcClient;
    const response = await client.rpc("current_employee_directory", {
      p_organization_public_id: organizationPublicId,
    });
    if (response.error) throw response.error;
    return directoryFromRows(toDirectoryRows(response.data));
  } catch {
    return emptySupabaseResult("员工目录加载失败，请稍后重试。");
  }
}

export async function loadEmployeePrivateProfile(
  employeePublicId: string,
  organizationPublicId: string,
  clientFactory: EmployeeDirectoryClientFactory = getSupabaseServerClient,
): Promise<EmployeePrivateProfileResult> {
  try {
    const client = await clientFactory() as unknown as RpcClient;
    const response = await client.rpc("current_employee_private_profile", {
      p_employee_public_id: employeePublicId,
      p_organization_public_id: organizationPublicId,
    });
    if (response.error) throw response.error;
    return { source: "supabase", data: toPrivateProfile(response.data) };
  } catch {
    return {
      source: "supabase",
      loadError: "员工私密档案加载失败，请稍后重试。",
    };
  }
}

export async function loadEmployeeCapabilityCenter(
  employeePublicId: string,
  organizationPublicId: string,
  clientFactory: EmployeeDirectoryClientFactory = getSupabaseServerClient,
): Promise<EmployeeCapabilityCenterResult> {
  try {
    const client = await clientFactory() as unknown as RpcClient;
    const response = await client.rpc("current_employee_capability_center", {
      p_employee_public_id: employeePublicId,
      p_organization_public_id: organizationPublicId,
      p_limit: 50,
    });
    if (response.error) throw response.error;
    const data = parseEmployeeCapabilityCenter(response.data);
    if (!data) throw new Error("employee_capability_contract_invalid");
    return { source: "supabase", data };
  } catch {
    return { source: "supabase", loadError: "员工能力与工作轨迹加载失败，请稍后重试。" };
  }
}
