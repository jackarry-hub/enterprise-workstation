import type {
  ProjectPriority,
  ProjectTask,
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
