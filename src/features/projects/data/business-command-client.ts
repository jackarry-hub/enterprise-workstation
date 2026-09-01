import type {
  ProjectDecisionCitation,
  ProjectDecisionStatus,
  ProjectDecisionType,
  ProjectPriority,
  ProjectSopRunStatus,
  ProjectSopStep,
  ProjectTask,
  ProjectRiskStatus,
  TaskComment,
  TaskPriority,
} from "@/features/projects/types";

type JsonRecord = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const commandErrors: Record<string, string> = {
  unauthorized: "登录状态已失效，请重新登录",
  forbidden: "当前账号没有执行该操作的权限",
  not_found: "目标记录不存在或已不可访问",
  stale_version: "记录已被他人更新，请刷新后重试",
  version_conflict: "任务已被他人更新，请刷新后重试",
  conflict: "操作与当前业务状态冲突，请刷新后重试",
  scope_conflict: "请求范围与当前企业不一致",
  invalid_request: "提交内容不完整或格式不正确",
  invalid_transition: "当前任务状态不允许该操作",
  invalid_state: "当前记录状态不允许该操作",
  restore_status_required: "历史归档项目缺少原状态，请选择安全的恢复状态",
  operating_model_unavailable: "项目运行模型服务暂时不可用，请稍后重试",
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function canonicalUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function allocation(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    && Math.round(value * 100) === value * 100 ? value : null;
}

function canonicalDate(value: unknown) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function timestamp(value: unknown) {
  return typeof value === "string" && TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function boundedText(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string" || value.length > maximum) return null;
  if (required && !value.trim()) return null;
  return value;
}

async function requestJson(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("网络连接失败，结果未确认；请保持页面并使用原操作重试");
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("服务返回异常，提交结果未确认，请刷新后核对");
  }
  const payload = record(value);
  if (!response.ok) {
    const code = typeof payload?.error === "string" ? payload.error : "";
    throw new Error(commandErrors[code] ?? "服务暂时不可用，提交结果未确认，请稍后重试");
  }
  if (!payload) throw new Error("服务返回异常，提交结果未确认，请刷新后核对");
  return payload;
}

function commandHeaders(idempotencyKey: string) {
  return {
    "content-type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
}

export type CreateBusinessProjectInput = {
  ownerPublicId: string;
  name: string;
  category: string;
  description: string;
  startsOn: string;
  dueOn: string;
  budgetAmount: string;
  priority: ProjectPriority;
  status: "planning" | "active";
  reason: string;
};

export async function createBusinessProject(
  input: CreateBusinessProjectInput,
  idempotencyKey: string,
) {
  const payload = await requestJson("/api/workstation/projects", {
    method: "POST",
    headers: commandHeaders(idempotencyKey),
    body: JSON.stringify({ ...input, version: 0 }),
  });
  const project = record(payload.project);
  const id = canonicalUuid(project?.id);
  const version = positiveInteger(project?.version);
  if (!id || !version) {
    throw new Error("项目已提交但返回结果无法确认，请刷新项目列表核对");
  }
  return { id, version };
}

export type UpdateBusinessProjectInput = {
  version: number;
  reason: string;
  name: string;
  description: string;
  category: string;
  ownerPublicId: string;
  budgetAmount: string;
  priority: ProjectPriority;
  startsOn: string;
  dueOn: string;
};

export async function updateBusinessProject(
  projectId: string,
  input: UpdateBusinessProjectInput,
  idempotencyKey: string,
) {
  const payload = await requestJson(`/api/workstation/projects/${projectId}`, {
    method: "PATCH",
    headers: commandHeaders(idempotencyKey),
    body: JSON.stringify(input),
  });
  const responseId = canonicalUuid(payload.id);
  const expectedId = canonicalUuid(projectId);
  const version = positiveInteger(payload.version);
  if (payload.outcome !== "success" || !responseId || responseId !== expectedId || !version) {
    throw new Error("项目更新结果无法确认，请刷新后核对");
  }
  return { version };
}

export async function archiveBusinessProject(
  projectId: string,
  version: number,
  reason: string,
  idempotencyKey: string,
) {
  const payload = await requestJson(`/api/workstation/projects/${projectId}`, {
    method: "DELETE",
    headers: commandHeaders(idempotencyKey),
    body: JSON.stringify({ version, reason }),
  });
  const id = canonicalUuid(payload.id);
  const nextVersion = positiveInteger(payload.version);
  if (payload.outcome !== "success" || id !== canonicalUuid(projectId) || !nextVersion) {
    throw new Error("项目归档结果无法确认，请刷新项目列表核对");
  }
  return { id, version: nextVersion };
}

export async function restoreBusinessProject(
  projectId: string,
  input: { expectedVersion: number; restoreStatus: "planning" | "active" | "on_hold" | "completed" | null; reason: string },
  idempotencyKey: string,
) {
  const payload = await requestJson(`/api/workstation/projects/${projectId}/restore`, {
    method: "POST",
    headers: commandHeaders(idempotencyKey),
    body: JSON.stringify(input),
  });
  const id = canonicalUuid(payload.id);
  const version = positiveInteger(payload.version);
  const status = typeof payload.status === "string"
    && ["planning", "active", "on_hold", "completed"].includes(payload.status)
    ? payload.status as "planning" | "active" | "on_hold" | "completed" : null;
  if (payload.outcome !== "success" || id !== canonicalUuid(projectId) || !version
    || !status) {
    throw new Error("项目恢复结果无法确认，请刷新归档项目核对");
  }
  return { id, version, status };
}

export async function mutateBusinessProjectMember(
  projectId: string,
  input: {
    command: "add" | "change_role" | "remove";
    employeePublicId: string;
    role?: "manager" | "member" | "viewer";
    allocationPercent?: number;
    expectedProjectVersion: number;
    expectedMembershipVersion: number;
    reason: string;
  },
  idempotencyKey: string,
) {
  const method = input.command === "remove" ? "DELETE" : "POST";
  const body = input.command === "remove" ? {
    employeePublicId: input.employeePublicId,
    expectedProjectVersion: input.expectedProjectVersion,
    expectedMembershipVersion: input.expectedMembershipVersion,
    reason: input.reason,
  } : {
    ...input,
    role: input.role,
    allocationPercent: input.allocationPercent,
  };
  const payload = await requestJson(`/api/workstation/projects/${projectId}/members`, {
    method,
    headers: commandHeaders(idempotencyKey),
    body: JSON.stringify(body),
  });
  const responseId = canonicalUuid(payload.id);
  const responseVersion = positiveInteger(payload.version);
  const responseProjectId = canonicalUuid(payload.projectId);
  const projectVersion = positiveInteger(payload.projectVersion);
  const member = record(payload.member);
  const id = canonicalUuid(member?.id);
  const employeePublicId = canonicalUuid(member?.employeePublicId);
  const version = positiveInteger(member?.version);
  const role = typeof member?.role === "string" && ["manager", "member", "viewer"].includes(member.role)
    ? member.role : null;
  const allocationPercent = allocation(member?.allocationPercent);
  const leftAt = member?.leftAt === null ? null : timestamp(member?.leftAt);
  if (payload.outcome !== "success" || payload.resource !== "project_member"
    || !id || responseId !== id || !version || responseVersion !== version
    || responseProjectId !== canonicalUuid(projectId)
    || !projectVersion || employeePublicId !== canonicalUuid(input.employeePublicId)
    || !role || allocationPercent === null
    || (member?.leftAt !== null && !leftAt)) {
    throw new Error("项目成员变更结果无法确认，请刷新成员列表核对");
  }
  return { projectVersion, member: { id, employeePublicId, version, role,
    allocationPercent, leftAt } };
}

export type BusinessTaskTransition =
  | { action: "claim"; expectedVersion: number }
  | { action: "progress"; expectedVersion: number; progress: number; blocker: string; nextStep: string }
  | { action: "submit"; expectedVersion: number; resultText: string; resultLink: string; resultFiles: string[] }
  | { action: "review"; expectedVersion: number; decision: "pass" | "reject"; note: string }
  | { action: "reopen"; expectedVersion: number; note: string };

export async function transitionBusinessTask(
  taskId: string,
  input: BusinessTaskTransition,
  idempotencyKey: string,
) {
  const payload = await requestJson(`/api/workstation/tasks/${taskId}`, {
    method: "PATCH",
    headers: commandHeaders(idempotencyKey),
    body: JSON.stringify(input),
  });
  const task = record(payload.task);
  const id = canonicalUuid(task?.id);
  const version = positiveInteger(task?.version);
  if (id !== canonicalUuid(taskId) || !version || typeof task?.st !== "string") {
    throw new Error("任务状态变更结果无法确认，请刷新任务核对");
  }
  return { id, version, displayStatus: task.st };
}

export type CreateBusinessTaskInput = {
  projectId: string;
  assigneeMemberId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  dueDate: string;
  priority: "P0" | "P1" | "P2" | "P3";
};

export type SubmittedBusinessReportConfirmation = {
  id: string;
  projectId: string;
  authorEmployeePublicId: string;
  reportDate: string;
  status: "submitted";
  summary: string;
  nextPlan: string;
  blockers?: string;
  supportNeeded?: string;
  updatedAt: string;
  version: number;
};

export type CreatedBusinessTaskComment = TaskComment & {
  authorEmployeePublicId: string;
};

export async function createBusinessTask(
  input: CreateBusinessTaskInput,
  idempotencyKey: string,
) {
  const payload = await requestJson("/api/workstation/tasks", {
    method: "POST",
    headers: commandHeaders(idempotencyKey),
    body: JSON.stringify(input),
  });
  const task = record(payload.task);
  const id = canonicalUuid(task?.id);
  const projectId = canonicalUuid(task?.p);
  if (!id || !projectId || projectId !== canonicalUuid(input.projectId)) {
    throw new Error("任务已提交但返回结果无法确认，请刷新任务列表核对");
  }
  return { id };
}

export async function submitBusinessProjectReport(
  projectId: string,
  input: {
    reportDate: string;
    summary: string;
    nextPlan: string;
    blockers: string;
    supportNeeded: string;
    reason: string;
  },
  idempotencyKey: string,
): Promise<SubmittedBusinessReportConfirmation> {
  const payload = await requestJson(`/api/workstation/projects/${projectId}/reports`, {
    method: "POST",
    headers: commandHeaders(idempotencyKey),
    body: JSON.stringify(input),
  });
  const entity = record(payload.entity);
  const id = canonicalUuid(entity?.id);
  const responseProjectId = canonicalUuid(entity?.projectId);
  const authorEmployeePublicId = canonicalUuid(entity?.authorPublicId);
  const reportDate = canonicalDate(entity?.reportDate);
  const summary = boundedText(entity?.summary, 8000, true);
  const nextPlan = boundedText(entity?.nextPlan, 8000, true);
  const blockers = boundedText(entity?.blockers ?? "", 8000);
  const supportNeeded = boundedText(entity?.supportNeeded ?? "", 8000);
  const updatedAt = timestamp(entity?.updatedAt);
  const version = positiveInteger(entity?.version);
  if (payload.resource !== "report" || !id || !responseProjectId
      || responseProjectId !== canonicalUuid(projectId) || !authorEmployeePublicId
      || !reportDate || entity?.status !== "submitted" || summary === null
      || nextPlan === null || blockers === null || supportNeeded === null
      || !updatedAt || !version) {
    throw new Error("日报提交结果无法确认，请刷新后核对");
  }
  return {
    id,
    projectId,
    authorEmployeePublicId,
    reportDate,
    status: "submitted",
    summary,
    nextPlan,
    blockers: blockers || undefined,
    supportNeeded: supportNeeded || undefined,
    updatedAt,
    version,
  };
}

export async function createBusinessTaskComment(
  task: Pick<ProjectTask, "id" | "projectId">,
  body: string,
  idempotencyKey: string,
): Promise<CreatedBusinessTaskComment> {
  const payload = await requestJson(`/api/workstation/tasks/${task.id}/comments`, {
    method: "POST",
    headers: commandHeaders(idempotencyKey),
    body: JSON.stringify({ body, reason: "补充任务评论" }),
  });
  const entity = record(payload.entity);
  const id = canonicalUuid(entity?.id);
  const responseTaskId = canonicalUuid(entity?.taskId);
  const responseProjectId = canonicalUuid(entity?.projectId);
  const authorEmployeePublicId = canonicalUuid(entity?.authorPublicId);
  const commentBody = boundedText(entity?.body, 8000, true);
  const createdAt = timestamp(entity?.createdAt);
  const updatedAt = timestamp(entity?.updatedAt);
  if (payload.resource !== "comment" || !id
      || responseTaskId !== canonicalUuid(task.id)
      || responseProjectId !== canonicalUuid(task.projectId)
      || !authorEmployeePublicId || commentBody === null
      || !positiveInteger(entity?.version) || !createdAt || !updatedAt) {
    throw new Error("评论提交结果无法确认，请刷新后核对");
  }
  return {
    id,
    organizationId: "",
    projectId: task.projectId,
    taskId: task.id,
    authorId: authorEmployeePublicId,
    authorEmployeePublicId,
    body: commentBody,
    createdAt,
    updatedAt,
  };
}

export function publicTaskPriority(priority: TaskPriority): CreateBusinessTaskInput["priority"] {
  if (priority === "urgent") return "P0";
  if (priority === "high") return "P1";
  if (priority === "medium") return "P2";
  return "P3";
}

async function operatingModelCommand(
  projectId: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
) {
  const payload = await requestJson(`/api/workstation/projects/${projectId}/operating-model`, {
    method: "POST",
    headers: commandHeaders(idempotencyKey),
    body: JSON.stringify(body),
  });
  const entity = record(payload.entity);
  const id = canonicalUuid(entity?.id); const responseProjectId = canonicalUuid(entity?.projectId);
  const version = positiveInteger(entity?.version);
  if (!id || responseProjectId !== canonicalUuid(projectId) || !version) {
    throw new Error("操作已提交但返回结果无法确认，请刷新后核对");
  }
  return { ...entity, id, projectId: responseProjectId as string, version };
}

export function saveBusinessProjectSop(
  projectId: string,
  input: {
    definitionId: string | null;
    code: string;
    name: string;
    description: string;
    steps: readonly ProjectSopStep[];
    publish: boolean;
    reason: string;
  },
  idempotencyKey: string,
) {
  return operatingModelCommand(projectId, { command: "save_sop", ...input }, idempotencyKey);
}

export function startBusinessProjectSop(
  projectId: string,
  input: { definitionId: string; taskId: string | null; assignedEmployeeId: string; reason: string },
  idempotencyKey: string,
) {
  return operatingModelCommand(projectId, { command: "start_sop", ...input }, idempotencyKey);
}

export function advanceBusinessProjectSop(
  projectId: string,
  input: {
    runId: string;
    action: "complete_step" | "request_human" | "resume" | "fail" | "cancel";
    expectedVersion: number;
    note: string;
    evidence: Record<string, unknown>;
    reason: string;
  },
  idempotencyKey: string,
): Promise<Record<string, unknown> & { id: string; projectId: string; version: number; status?: ProjectSopRunStatus }> {
  return operatingModelCommand(projectId, { command: "advance_sop", ...input }, idempotencyKey);
}

export function recordBusinessProjectDecision(
  projectId: string,
  input: {
    type: ProjectDecisionType;
    title: string;
    summary: string;
    citations: readonly ProjectDecisionCitation[];
    ownerEmployeeId: string;
    reason: string;
  },
  idempotencyKey: string,
) {
  return operatingModelCommand(projectId, { command: "record_decision", ...input }, idempotencyKey);
}

export function transitionBusinessProjectDecision(
  projectId: string,
  input: { decisionId: string; status: Exclude<ProjectDecisionStatus, "proposed">; expectedVersion: number; reason: string },
  idempotencyKey: string,
) {
  return operatingModelCommand(projectId, { command: "transition_decision", ...input }, idempotencyKey);
}

export function saveBusinessProjectRetrospective(
  projectId: string,
  input: { outcome: string; wins: string; lessons: string; followUps: string; expectedVersion: number; reason: string },
  idempotencyKey: string,
) {
  return operatingModelCommand(projectId, { command: "save_retrospective", ...input }, idempotencyKey);
}

export function updateBusinessProjectRiskStatus(
  projectId: string,
  input: { riskId: string; status: ProjectRiskStatus; expectedVersion: number; reason: string },
  idempotencyKey: string,
) {
  return operatingModelCommand(projectId, { command: "update_risk", ...input }, idempotencyKey);
}
