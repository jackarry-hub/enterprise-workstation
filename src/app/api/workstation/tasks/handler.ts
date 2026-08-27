import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import {
  dispatchTaskAssignedNotification,
  type TaskNotificationScope,
} from "@/features/workstation/task-notification";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MEMBER_PATTERN = /^[1-9]\d*$/;
const MAX_BODY_BYTES = 32 * 1024;
const PRIORITIES = { P0: "urgent", P1: "high", P2: "medium", P3: "low" } as const;
const PUBLIC_PRIORITIES = { urgent: "P0", high: "P1", medium: "P2", low: "P3" } as const;
const PUBLIC_STATUSES = {
  backlog: "待处理", todo: "待处理", in_progress: "进行中",
  in_review: "待验收", done: "已完成", cancelled: "已取消",
} as const;
const COMMAND_FAILURES = new Set([
  "forbidden", "not_found", "scope_conflict", "conflict", "command_failed",
  "version_conflict", "invalid_transition",
]);

export type TaskCreateSession = {
  tenantId: string;
  organization: { id: string };
  member: { id: number };
  permissionCodes: readonly string[];
};

export type TaskCreateItem = {
  projectId: string;
  assigneeMemberId: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
  dueDate: string;
  priority: "urgent" | "high" | "medium" | "low";
};

export type TaskCreateInput = TaskCreateItem & {
  idempotencyKey: string;
  requestId: string;
};

export type TaskBatchCommandInput = {
  items: TaskCreateItem[];
  idempotencyKey: string;
  requestId: string;
};

export type WorkstationTaskCreateDependencies = {
  loadSession: () => Promise<TaskCreateSession | null>;
  createTask: (input: TaskCreateInput) => Promise<unknown>;
  notifyTask: (scope: TaskNotificationScope) => ReturnType<typeof dispatchTaskAssignedNotification>;
};

export function canonicalUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function strictKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allow = new Set(allowed);
  return Object.keys(value).every((key) => allow.has(key));
}

function cleanText(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  if ((required && !parsed) || parsed.length > maximum) return null;
  return parsed;
}

function memberId(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^m([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function canonicalDate(value: unknown) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function timestamp(value: unknown, nullable = false) {
  if (nullable && value === null) return null;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

export function parseTaskCreate(value: unknown): TaskCreateItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!strictKeys(body, [
    "projectId", "assigneeMemberId", "title", "description",
    "acceptanceCriteria", "dueDate", "priority",
  ])) return null;
  const projectId = canonicalUuid(body.projectId);
  const assigneeMemberId = memberId(body.assigneeMemberId);
  const title = cleanText(body.title, 240, true);
  const description = cleanText(body.description ?? "", 4000);
  const acceptanceCriteria = cleanText(body.acceptanceCriteria, 2000, true);
  const dueDate = canonicalDate(body.dueDate);
  const priority = typeof body.priority === "string"
    ? PRIORITIES[body.priority as keyof typeof PRIORITIES]
    : null;
  if (!projectId || !assigneeMemberId || title === null || description === null
    || acceptanceCriteria === null || !dueDate || !priority) return null;
  return { projectId, assigneeMemberId, title, description, acceptanceCriteria, dueDate, priority };
}

export async function readStrictJson(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; error: "unsupported_media_type" | "payload_too_large" | "invalid_request" }
> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return { ok: false, error: "unsupported_media_type" };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, error: "payload_too_large" };
  let raw: string;
  try { raw = await request.text(); }
  catch { return { ok: false, error: "invalid_request" }; }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return { ok: false, error: "payload_too_large" };
  try { return { ok: true, value: JSON.parse(raw) as unknown }; }
  catch { return { ok: false, error: "invalid_request" }; }
}

type CanonicalTask = {
  id: string;
  projectId: string;
  assigneeMemberId: string;
  reporterMemberId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  status: keyof typeof PUBLIC_STATUSES;
  priority: keyof typeof PUBLIC_PRIORITIES;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  blocker: string;
  nextStep: string;
  resultText: string;
  resultLink: string;
  resultFiles: string[];
  reviewNote: string;
  acceptedAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

function canonicalTask(value: unknown): CanonicalTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = canonicalUuid(row.id);
  const projectId = canonicalUuid(row.projectId);
  const assigneeMemberId = typeof row.assigneeMemberId === "string" && MEMBER_PATTERN.test(row.assigneeMemberId)
    ? row.assigneeMemberId : null;
  const reporterMemberId = typeof row.reporterMemberId === "string" && MEMBER_PATTERN.test(row.reporterMemberId)
    ? row.reporterMemberId : null;
  const status = typeof row.status === "string" && row.status in PUBLIC_STATUSES
    ? row.status as keyof typeof PUBLIC_STATUSES : null;
  const priority = typeof row.priority === "string" && row.priority in PUBLIC_PRIORITIES
    ? row.priority as keyof typeof PUBLIC_PRIORITIES : null;
  const startDate = row.startDate === null ? null : canonicalDate(row.startDate);
  const dueDate = row.dueDate === null ? null : canonicalDate(row.dueDate);
  const nullableTimes = ["acceptedAt", "submittedAt", "reviewedAt", "completedAt"] as const;
  const times = Object.fromEntries(nullableTimes.map((key) => [key, timestamp(row[key], true)])) as Record<typeof nullableTimes[number], string | null | undefined>;
  const createdAt = timestamp(row.createdAt);
  const updatedAt = timestamp(row.updatedAt);
  if (!id || !projectId || !assigneeMemberId || !reporterMemberId || !status || !priority
    || typeof row.title !== "string" || typeof row.description !== "string"
    || typeof row.acceptanceCriteria !== "string" || (startDate === null && row.startDate !== null)
    || (dueDate === null && row.dueDate !== null)
    || typeof row.progress !== "number" || !Number.isFinite(row.progress) || row.progress < 0 || row.progress > 100
    || typeof row.blocker !== "string" || typeof row.nextStep !== "string"
    || typeof row.resultText !== "string" || typeof row.resultLink !== "string"
    || !Array.isArray(row.resultFiles) || row.resultFiles.some((item) => typeof item !== "string")
    || typeof row.reviewNote !== "string" || nullableTimes.some((key) => times[key] === undefined)
    || typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 1
    || !createdAt || !updatedAt) return null;
  return {
    id, projectId, assigneeMemberId, reporterMemberId,
    title: row.title, description: row.description, acceptanceCriteria: row.acceptanceCriteria,
    status, priority, startDate, dueDate, progress: row.progress,
    blocker: row.blocker, nextStep: row.nextStep, resultText: row.resultText,
    resultLink: row.resultLink, resultFiles: row.resultFiles as string[], reviewNote: row.reviewNote,
    acceptedAt: times.acceptedAt!, submittedAt: times.submittedAt!, reviewedAt: times.reviewedAt!,
    completedAt: times.completedAt!, version: row.version, createdAt, updatedAt,
  };
}

export function publicTaskFromCanonical(value: unknown) {
  const task = canonicalTask(value);
  if (!task) return null;
  return {
    id: task.id,
    n: task.title,
    p: task.projectId,
    own: `m${task.assigneeMemberId}`,
    createdBy: `m${task.reporterMemberId}`,
    reviewer: `m${task.reporterMemberId}`,
    role: "",
    pri: PUBLIC_PRIORITIES[task.priority],
    st: PUBLIC_STATUSES[task.status],
    s: task.startDate ?? "",
    e: task.dueDate ?? "",
    pr: task.progress,
    description: task.description,
    ac: task.acceptanceCriteria,
    blocker: task.blocker,
    reviewNote: task.reviewNote,
    nextStep: task.nextStep,
    resultText: task.resultText,
    resultLink: task.resultLink,
    resultFiles: task.resultFiles,
    acceptedAt: task.acceptedAt ?? "",
    submittedAt: task.submittedAt ?? "",
    reviewedAt: task.reviewedAt ?? "",
    completedAt: task.completedAt ?? "",
    version: task.version,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    timeline: [],
    src: "飞书工作站",
    dep: [],
  };
}

export function parseTaskBatchCommand(value: unknown, expectedCount: number, expectedKey: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const command = value as Record<string, unknown>;
  if (command.outcome !== "success" || command.resource !== "task_batch"
    || canonicalUuid(command.id) !== expectedKey
    || command.version !== 1 || !Array.isArray(command.taskIds) || !Array.isArray(command.tasks)
    || command.taskIds.length !== expectedCount || command.tasks.length !== expectedCount) return null;
  const taskIds = command.taskIds.map(canonicalUuid);
  const tasks = command.tasks.map(publicTaskFromCanonical);
  if (taskIds.some((id) => !id) || new Set(taskIds).size !== expectedCount
    || tasks.some((task) => !task)
    || tasks.some((task, index) => task!.id !== taskIds[index])) return null;
  return { taskIds: taskIds as string[], tasks: tasks as NonNullable<ReturnType<typeof publicTaskFromCanonical>>[] };
}

export function commandFailure(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const command = value as Record<string, unknown>;
  if (command.outcome !== "failure") return null;
  return typeof command.error === "string" && COMMAND_FAILURES.has(command.error)
    ? command.error
    : "command_failed";
}

export const defaultWorkstationTaskCreateDependencies: WorkstationTaskCreateDependencies = {
  loadSession: getWorkspaceSession,
  notifyTask: dispatchTaskAssignedNotification,
  async createTask(input) {
    const client = await getSupabaseServerClient();
    const item: TaskCreateItem = {
      projectId: input.projectId,
      assigneeMemberId: input.assigneeMemberId,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      dueDate: input.dueDate,
      priority: input.priority,
    };
    const { data, error } = await client.rpc("create_current_task_batch_v3", {
      items: [item], idempotency_key: input.idempotencyKey, request_id: input.requestId,
    });
    if (error) throw error;
    return data;
  },
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function domainStatus(error: string) {
  if (error === "forbidden") return 403;
  if (error === "not_found") return 404;
  if (["scope_conflict", "conflict"].includes(error)) return 409;
  return 503;
}

export function createWorkstationTaskCreateHandler(dependencies: WorkstationTaskCreateDependencies) {
  return async function createTask(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) return jsonError("unauthorized", 401);
    const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
    if (!idempotencyKey) return jsonError("invalid_idempotency_key", 400);
    const parsedBody = await readStrictJson(request);
    if (!parsedBody.ok) {
      return jsonError(parsedBody.error, parsedBody.error === "unsupported_media_type" ? 415
        : parsedBody.error === "payload_too_large" ? 413 : 400);
    }
    const input = parseTaskCreate(parsedBody.value);
    if (!input) return jsonError("invalid_request", 400);
    let result: unknown;
    try {
      result = await dependencies.createTask({ ...input, idempotencyKey, requestId: randomUUID() });
    } catch {
      return jsonError("task_create_failed", 503);
    }
    const failure = commandFailure(result);
    if (failure) return jsonError(failure, domainStatus(failure));
    const parsed = parseTaskBatchCommand(result, 1, idempotencyKey);
    if (!parsed) return jsonError("task_create_failed", 503);
    const task = parsed.tasks[0];
    let notification: Awaited<ReturnType<typeof dispatchTaskAssignedNotification>>;
    try {
      notification = await dependencies.notifyTask({
        tenantId: session.tenantId, organizationId: session.organization.id, taskId: task.id,
      });
    } catch {
      notification = { status: "failed", errorCode: "send_failed" };
    }
    return NextResponse.json({ task, notification }, { status: 201 });
  };
}
