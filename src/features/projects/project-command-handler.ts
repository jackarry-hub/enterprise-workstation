import { randomUUID } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^(0|[1-9]\d{0,15})(?:\.(\d{1,2}))?$/;
const PROJECT_FAILURES = new Set([
  "forbidden", "not_found", "stale_version", "conflict", "scope_conflict", "invalid_request",
]);

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{
  data: unknown;
  error: { code?: string } | null;
}>;

export type ProjectCommandDependencies = {
  session: { permissionCodes: readonly string[]; member: { status: string } } | null;
  rpc: Rpc;
  createRequestId?: () => string;
};

type Context = { params: Promise<{ projectId: string }> };

function canonicalUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  return (!required || parsed.length > 0) && parsed.length <= maximum ? parsed : null;
}

function date(value: unknown) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function money(value: unknown) {
  if (typeof value !== "string") return null;
  const match = MONEY_PATTERN.exec(value.trim());
  return match ? `${match[1]}.${(match[2] ?? "").padEnd(2, "0")}` : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function body(request: Request) {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function allowed(dependencies: ProjectCommandDependencies) {
  const session = dependencies.session;
  return Boolean(session) && session?.member.status === "active" && (
    session.permissionCodes.includes("project.manage")
    || session.permissionCodes.includes("organization.manage")
  );
}

function failureStatus(error: string) {
  if (error === "forbidden") return 403;
  if (error === "not_found") return 404;
  if (["stale_version", "conflict", "scope_conflict"].includes(error)) return 409;
  return error === "invalid_request" ? 400 : 503;
}

function publicFailure(error: string) {
  return PROJECT_FAILURES.has(error) ? error : "project_command_unavailable";
}

function mapResult(raw: unknown, projectId: string) {
  if (!raw || typeof raw !== "object") return json({ error: "project_command_unavailable" }, 503);
  const row = raw as Record<string, unknown>;
  if (row.outcome === "failure" && typeof row.error === "string") {
    const error = publicFailure(row.error);
    return json({ error }, failureStatus(error));
  }
  const id = canonicalUuid(row.id);
  if (row.outcome !== "success" || id !== projectId
      || !Number.isSafeInteger(row.version) || Number(row.version) <= 0) {
    return json({ error: "project_command_unavailable" }, 503);
  }
  return json({ outcome: "success", id, version: Number(row.version) });
}

async function invoke(
  request: Request,
  context: Context,
  dependencies: ProjectCommandDependencies,
  operation: "update" | "archive",
) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (!allowed(dependencies)) return json({ error: "forbidden" }, 403);
  const projectId = canonicalUuid((await context.params).projectId);
  if (!projectId) return json({ error: "invalid_request" }, 400);
  const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
  if (!idempotencyKey) return json({ error: "invalid_idempotency_key" }, 400);
  const parsed = await body(request);
  if (!parsed || ["tenantId", "organizationId", "actorId"].some((field) => field in parsed)) {
    return json({ error: "invalid_request" }, 400);
  }
  const version = positiveInteger(parsed.version);
  const reason = text(parsed.reason, 500, true);
  if (!version || !reason) return json({ error: "invalid_request" }, 400);
  const common = {
    p_project_public_id: projectId,
    p_expected_version: version,
    p_reason: reason,
    request_id: dependencies.createRequestId?.() ?? randomUUID(),
    idempotency_key: idempotencyKey,
  };
  let name: string;
  let args: Record<string, unknown>;
  if (operation === "archive") {
    name = "archive_current_project";
    args = common;
  } else {
    const projectName = text(parsed.name, 160, true);
    const ownerPublicId = canonicalUuid(parsed.ownerPublicId);
    const budgetAmount = money(parsed.budgetAmount);
    const startsOn = date(parsed.startsOn);
    const dueOn = date(parsed.dueOn);
    const description = text(parsed.description ?? "", 4000);
    const category = text(parsed.category ?? "企业项目", 80, true);
    const rawPriority = parsed.priority === undefined
      ? "medium"
      : typeof parsed.priority === "string" ? parsed.priority : null;
    const priority = rawPriority !== null && ["low", "medium", "high", "critical"].includes(rawPriority)
      ? rawPriority
      : null;
    if (!projectName || !ownerPublicId || budgetAmount === null || !startsOn || !dueOn
        || startsOn > dueOn || description === null || !category || !priority) {
      return json({ error: "invalid_request" }, 400);
    }
    name = "update_current_project";
    args = {
      ...common,
      p_name: projectName,
      p_description: description,
      p_category: category,
      p_owner_employee_public_id: ownerPublicId,
      p_budget_amount: budgetAmount,
      p_priority: priority,
      p_starts_on: startsOn,
      p_due_on: dueOn,
    };
  }
  try {
    const result = await dependencies.rpc(name, args);
    if (result.error) {
      if (result.error.code === "42501") return json({ error: "forbidden" }, 403);
      if (result.error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
      return json({ error: "project_command_unavailable" }, 503);
    }
    return mapResult(result.data, projectId);
  } catch {
    return json({ error: "project_command_unavailable" }, 503);
  }
}

export function handleProjectUpdateCommand(
  request: Request,
  context: Context,
  dependencies: ProjectCommandDependencies,
) {
  return invoke(request, context, dependencies, "update");
}

export function handleProjectArchiveCommand(
  request: Request,
  context: Context,
  dependencies: ProjectCommandDependencies,
) {
  return invoke(request, context, dependencies, "archive");
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
