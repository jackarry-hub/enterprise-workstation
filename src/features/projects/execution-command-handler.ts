import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type ProjectExecutionResource =
  | "milestone"
  | "risk"
  | "activity"
  | "report"
  | "comment"
  | "dependency";

type RpcResult = {
  data: unknown;
  error: { code?: string } | null;
};

export type ProjectExecutionCommandDependencies = {
  session: {
    member: { status: string };
    permissionCodes: readonly string[];
  } | null;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  createRequestId?: () => string;
};

type CommandContext = {
  params: Promise<{ projectId?: string; taskId?: string }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 32_768;
const COMMAND_FIELDS: Record<ProjectExecutionResource, ReadonlySet<string>> = {
  milestone: new Set(["name", "description", "ownerPublicId", "startDate", "dueDate", "progress", "reason"]),
  risk: new Set(["title", "level", "ownerPublicId", "deadline", "reason"]),
  activity: new Set(["content", "reason"]),
  report: new Set(["reportDate", "summary", "nextPlan", "blockers", "supportNeeded", "reason"]),
  comment: new Set(["body", "reason"]),
  dependency: new Set(["dependsOnTaskId", "reason"]),
};
const FAILURE_CODES = new Set([
  "forbidden",
  "not_found",
  "conflict",
  "scope_conflict",
  "task_dependency_cycle",
  "invalid_request",
]);

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function canonicalUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  return (!required || parsed.length > 0) && parsed.length <= maximum
    ? parsed
    : null;
}

function date(value: unknown, required = true) {
  if (!required && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime())
    ? value
    : null;
}

function percentage(value: unknown, fallback = 0) {
  const parsed = value === undefined ? fallback : value;
  return typeof parsed === "number" && Number.isFinite(parsed)
    && parsed >= 0 && parsed <= 100
    ? parsed
    : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

async function body(request: Request) {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return null;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function failureStatus(code: string) {
  if (code === "forbidden") return 403;
  if (code === "not_found") return 404;
  if (code === "task_dependency_cycle") return 422;
  if (code === "conflict" || code === "scope_conflict") return 409;
  if (code === "invalid_request") return 400;
  return 503;
}

function publicFailure(code: string) {
  return FAILURE_CODES.has(code) ? code : "project_execution_unavailable";
}

function commonEntity(
  raw: unknown,
  resource: ProjectExecutionResource,
  expectedScopeId: string,
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const result = raw as Record<string, unknown>;
  if (result.outcome === "failure" && typeof result.error === "string") {
    return { failure: publicFailure(result.error) } as const;
  }
  const id = canonicalUuid(result.id);
  const version = positiveInteger(result.version);
  if (result.outcome !== "success" || result.resource !== resource || !id || !version
      || !result.entity || typeof result.entity !== "object" || Array.isArray(result.entity)) {
    return null;
  }
  const entity = result.entity as Record<string, unknown>;
  if (canonicalUuid(entity.id) !== id || entity.version !== version) return null;
  const projectId = canonicalUuid(entity.projectId);
  const taskId = canonicalUuid(entity.taskId);
  if ((resource === "comment" || resource === "dependency")
    ? taskId !== expectedScopeId
    : projectId !== expectedScopeId) return null;
  return { id, version, entity } as const;
}

function canonicalEntity(
  raw: unknown,
  resource: ProjectExecutionResource,
  expectedScopeId: string,
) {
  const common = commonEntity(raw, resource, expectedScopeId);
  if (!common || "failure" in common) return common;
  const source = common.entity;
  const id = common.id;
  const version = common.version;
  const projectId = canonicalUuid(source.projectId);
  if (!projectId) return null;

  if (resource === "milestone") {
    const ownerPublicId = canonicalUuid(source.ownerPublicId);
    const name = text(source.name, 160, true);
    const description = text(source.description, 4000);
    const status = typeof source.status === "string"
      && ["pending", "in_progress", "completed", "overdue"].includes(source.status)
      ? source.status
      : null;
    const startDate = date(source.startDate, false);
    const dueDate = date(source.dueDate);
    const progress = percentage(source.progress);
    const sortOrder = typeof source.sortOrder === "number" && Number.isSafeInteger(source.sortOrder)
      && source.sortOrder >= 0 ? source.sortOrder : null;
    const updatedAt = timestamp(source.updatedAt);
    if (!ownerPublicId || !name || description === null || !status || startDate === undefined
        || !dueDate || progress === null || sortOrder === null || !updatedAt) return null;
    return {
      id, projectId, ownerPublicId, name, description, status,
      startDate, dueDate, progress, sortOrder, version, updatedAt,
    };
  }

  if (resource === "risk") {
    const ownerPublicId = canonicalUuid(source.ownerPublicId);
    const title = text(source.title, 200, true);
    const level = typeof source.level === "string"
      && ["low", "medium", "high", "critical"].includes(source.level) ? source.level : null;
    const status = typeof source.status === "string"
      && ["open", "monitoring", "mitigated", "closed"].includes(source.status) ? source.status : null;
    const deadline = date(source.deadline);
    const updatedAt = timestamp(source.updatedAt);
    if (!ownerPublicId || !title || !level || !status || !deadline || !updatedAt) return null;
    return { id, projectId, ownerPublicId, title, level, status, deadline, version, updatedAt };
  }

  if (resource === "activity") {
    const content = text(source.content, 4000, true);
    const createdAt = timestamp(source.createdAt);
    if (!content || !createdAt) return null;
    return { id, projectId, content, version, createdAt };
  }

  if (resource === "report") {
    const authorPublicId = canonicalUuid(source.authorPublicId);
    const reportDate = date(source.reportDate);
    const status = source.status === "submitted" ? "submitted" : null;
    const summary = text(source.summary, 8000, true);
    const nextPlan = text(source.nextPlan, 8000, true);
    const blockers = text(source.blockers ?? "", 8000);
    const supportNeeded = text(source.supportNeeded ?? "", 8000);
    const updatedAt = timestamp(source.updatedAt);
    if (!authorPublicId || !reportDate || !status || !summary || !nextPlan
        || blockers === null || supportNeeded === null || !updatedAt) return null;
    return {
      id, projectId, authorPublicId, reportDate, status, summary, nextPlan,
      blockers, supportNeeded, version, updatedAt,
    };
  }

  if (resource === "comment") {
    const taskId = canonicalUuid(source.taskId);
    const authorPublicId = canonicalUuid(source.authorPublicId);
    const commentBody = text(source.body, 8000, true);
    const createdAt = timestamp(source.createdAt);
    const updatedAt = timestamp(source.updatedAt);
    if (!taskId || !authorPublicId || !commentBody || !createdAt || !updatedAt) return null;
    return { id, taskId, projectId, authorPublicId, body: commentBody, version, createdAt, updatedAt };
  }

  const taskId = canonicalUuid(source.taskId);
  const dependsOnTaskId = canonicalUuid(source.dependsOnTaskId);
  const createdAt = timestamp(source.createdAt);
  if (!taskId || !dependsOnTaskId || !createdAt) return null;
  return { id, taskId, projectId, dependsOnTaskId, version, createdAt };
}

function parseCommand(
  resource: ProjectExecutionResource,
  parsed: Record<string, unknown>,
  scopeId: string,
) {
  if (Object.keys(parsed).some((field) => !COMMAND_FIELDS[resource].has(field))) return null;
  const reason = text(parsed.reason, 500, true);
  if (!reason) return null;

  if (resource === "milestone") {
    const name = text(parsed.name, 160, true);
    const description = text(parsed.description ?? "", 4000);
    const ownerPublicId = canonicalUuid(parsed.ownerPublicId);
    const startDate = date(parsed.startDate, false);
    const dueDate = date(parsed.dueDate);
    const progress = percentage(parsed.progress);
    if (!name || description === null || !ownerPublicId || startDate === undefined
        || !dueDate || (startDate && startDate > dueDate) || progress === null) return null;
    return {
      rpc: "create_current_project_milestone",
      args: {
        p_project_public_id: scopeId, p_name: name, p_description: description,
        p_owner_employee_public_id: ownerPublicId, p_start_date: startDate,
        p_due_date: dueDate, p_progress: progress, p_reason: reason,
      },
    };
  }

  if (resource === "risk") {
    const title = text(parsed.title, 200, true);
    const level = typeof parsed.level === "string"
      && ["low", "medium", "high", "critical"].includes(parsed.level) ? parsed.level : null;
    const ownerPublicId = canonicalUuid(parsed.ownerPublicId);
    const deadline = date(parsed.deadline);
    if (!title || !level || !ownerPublicId || !deadline) return null;
    return {
      rpc: "create_current_project_risk",
      args: {
        p_project_public_id: scopeId, p_title: title, p_level: level,
        p_owner_employee_public_id: ownerPublicId, p_deadline: deadline, p_reason: reason,
      },
    };
  }

  if (resource === "activity") {
    const content = text(parsed.content, 4000, true);
    if (!content) return null;
    return {
      rpc: "record_current_project_activity",
      args: { p_project_public_id: scopeId, p_content: content, p_reason: reason },
    };
  }

  if (resource === "report") {
    const reportDate = date(parsed.reportDate);
    const summary = text(parsed.summary, 8000, true);
    const nextPlan = text(parsed.nextPlan, 8000, true);
    const blockers = text(parsed.blockers ?? "", 8000);
    const supportNeeded = text(parsed.supportNeeded ?? "", 8000);
    if (!reportDate || !summary || !nextPlan || blockers === null || supportNeeded === null) return null;
    return {
      rpc: "submit_current_project_report",
      args: {
        p_project_public_id: scopeId, p_report_date: reportDate, p_summary: summary,
        p_next_plan: nextPlan, p_blockers: blockers, p_support_needed: supportNeeded,
        p_reason: reason,
      },
    };
  }

  if (resource === "comment") {
    const commentBody = text(parsed.body, 8000, true);
    if (!commentBody) return null;
    return {
      rpc: "create_current_task_comment",
      args: { p_task_public_id: scopeId, p_body: commentBody, p_reason: reason },
    };
  }

  const dependsOnTaskId = canonicalUuid(parsed.dependsOnTaskId);
  if (!dependsOnTaskId) return null;
  if (dependsOnTaskId === scopeId) {
    return { failure: "task_dependency_cycle" } as const;
  }
  return {
    rpc: "create_current_task_dependency",
    args: { p_task_public_id: scopeId, p_depends_on_task_public_id: dependsOnTaskId, p_reason: reason },
  };
}

export function createProjectExecutionCommandHandler(
  resource: ProjectExecutionResource,
  dependencies: ProjectExecutionCommandDependencies,
) {
  return async function handle(request: Request, context: CommandContext) {
    const session = dependencies.session;
    if (!session) return json({ error: "unauthorized" }, 401);
    if (session.member.status !== "active") return json({ error: "forbidden" }, 403);
    const params = await context.params;
    const rawScopeId = resource === "comment" || resource === "dependency"
      ? params.taskId
      : params.projectId;
    const scopeId = canonicalUuid(rawScopeId);
    if (!scopeId) return json({ error: "invalid_request" }, 400);
    const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
    if (!idempotencyKey) return json({ error: "invalid_idempotency_key" }, 400);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "invalid_request" }, 400);
    }
    const parsed = await body(request);
    if (!parsed) return json({ error: "invalid_request" }, 400);
    const command = parseCommand(resource, parsed, scopeId);
    if (!command) return json({ error: "invalid_request" }, 400);
    if ("failure" in command && typeof command.failure === "string") {
      return json({ error: command.failure }, failureStatus(command.failure));
    }

    try {
      const result = await dependencies.rpc(command.rpc, {
        ...command.args,
        request_id: dependencies.createRequestId?.() ?? randomUUID(),
        idempotency_key: idempotencyKey,
      });
      if (result.error) {
        if (result.error.code === "42501") return json({ error: "forbidden" }, 403);
        if (result.error.code === "23514") return json({ error: "invalid_request" }, 400);
        if (result.error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
        return json({ error: "project_execution_unavailable" }, 503);
      }
      const entity = canonicalEntity(result.data, resource, scopeId);
      if (!entity) return json({ error: "project_execution_unavailable" }, 503);
      if ("failure" in entity && typeof entity.failure === "string") {
        return json({ error: entity.failure }, failureStatus(entity.failure));
      }
      return json({ resource, entity }, 201);
    } catch {
      return json({ error: "project_execution_unavailable" }, 503);
    }
  };
}

export async function handleDefaultProjectExecutionCommand(
  resource: ProjectExecutionResource,
  request: Request,
  context: CommandContext,
) {
  try {
    const session = await getWorkspaceSession();
    const client = await getSupabaseServerClient();
    return createProjectExecutionCommandHandler(resource, {
      session,
      rpc: async (name, args) => {
        const result = await client.rpc(name, args);
        return { data: result.data, error: result.error };
      },
    })(request, context);
  } catch {
    return json({ error: "project_execution_unavailable" }, 503);
  }
}
