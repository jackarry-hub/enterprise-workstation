import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^(0|[1-9]\d{0,15})(?:\.(\d{1,2}))?$/;
const PROJECT_FAILURES = new Set([
  "forbidden", "not_found", "stale_version", "conflict", "scope_conflict", "invalid_request",
]);

export type ProjectCreateSession = {
  member: { status: string };
  permissionCodes: readonly string[];
};

export type ProjectCreateInput = {
  ownerPublicId: string;
  name: string;
  category: string;
  description: string;
  startsOn: string;
  dueOn: string;
  budgetAmount: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "planning" | "active";
  version: 0;
  reason: string;
  requestId: string;
  idempotencyKey: string;
};

export type WorkstationProjectCreateDependencies = {
  loadSession: () => Promise<ProjectCreateSession | null>;
  createProject: (input: ProjectCreateInput) => Promise<unknown>;
  createRequestId?: () => string;
};

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  return (!required || parsed.length > 0) && parsed.length <= maximum ? parsed : null;
}

function canonicalUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function date(value: unknown) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function money(value: unknown) {
  if (typeof value !== "string") return null;
  const match = MONEY_PATTERN.exec(value.trim());
  if (!match) return null;
  return `${match[1]}.${(match[2] ?? "").padEnd(2, "0")}`;
}

function canCreateProject(session: ProjectCreateSession) {
  return session.member.status === "active" && (
    session.permissionCodes.includes("project.manage")
    || session.permissionCodes.includes("organization.manage")
  );
}

export function parseProjectCreate(
  value: unknown,
): Omit<ProjectCreateInput, "requestId" | "idempotencyKey"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (["tenantId", "organizationId", "actorId", "actorMemberId"].some((field) => field in body)) return null;
  const name = text(body.name, 160, true);
  const ownerPublicId = canonicalUuid(body.ownerPublicId);
  const category = text(body.category ?? "企业项目", 80, true);
  const description = text(body.description ?? "", 4000);
  const startsOn = date(body.startsOn ?? body.startDate);
  const dueOn = date(body.dueOn ?? body.dueDate);
  const budgetAmount = money(body.budgetAmount);
  const rawPriority = body.priority === undefined
    ? "medium"
    : typeof body.priority === "string" ? body.priority : null;
  const priority = rawPriority !== null && ["low", "medium", "high", "critical"].includes(rawPriority)
    ? rawPriority as ProjectCreateInput["priority"]
    : null;
  const rawStatus = body.status === undefined
    ? "planning"
    : typeof body.status === "string" ? body.status : null;
  const status = rawStatus !== null && ["planning", "active"].includes(rawStatus)
    ? rawStatus as ProjectCreateInput["status"]
    : null;
  const version = body.version === 0 ? 0 as const : null;
  const reason = text(body.reason ?? "创建项目", 500, true);
  if (!name || !ownerPublicId || !category || description === null || !startsOn || !dueOn
      || startsOn > dueOn || budgetAmount === null || !priority || !status || version !== 0 || !reason) {
    return null;
  }
  return {
    ownerPublicId, name, category, description, startsOn, dueOn, budgetAmount,
    priority, status, version, reason,
  };
}

function success(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = canonicalUuid(row.id);
  const version = Number.isSafeInteger(row.version) && Number(row.version) > 0
    ? Number(row.version)
    : null;
  if (row.outcome !== "success" || !id || !version
      || !row.project || typeof row.project !== "object" || Array.isArray(row.project)) return null;
  const project = row.project as Record<string, unknown>;
  const projectId = canonicalUuid(project.id);
  const ownerPublicId = canonicalUuid(project.ownerPublicId);
  const name = text(project.name, 160, true);
  const category = text(project.category, 80, true);
  const budgetAmount = money(project.budgetAmount);
  const startsOn = date(project.startsOn);
  const dueOn = date(project.dueOn);
  const status = typeof project.status === "string" && ["planning", "active"].includes(project.status)
    ? project.status as ProjectCreateInput["status"]
    : null;
  const priority = typeof project.priority === "string"
    && ["low", "medium", "high", "critical"].includes(project.priority)
    ? project.priority as ProjectCreateInput["priority"]
    : null;
  const health = typeof project.health === "string"
    && ["on_track", "at_risk", "off_track"].includes(project.health)
    ? project.health
    : null;
  const progress = typeof project.progress === "number" && Number.isFinite(project.progress)
    && project.progress >= 0 && project.progress <= 100 ? project.progress : null;
  const updatedAt = typeof project.updatedAt === "string"
    && Number.isFinite(new Date(project.updatedAt).getTime()) ? project.updatedAt : null;
  if (projectId !== id || project.version !== version || !ownerPublicId || !name || !category
      || budgetAmount === null || !startsOn || !dueOn || !status || !priority || !health
      || progress === null || !updatedAt) return null;
  return {
    id, version, name, ownerPublicId, category, budgetAmount, status, priority,
    health, progress, startsOn, dueOn, updatedAt,
  };
}

function failure(value: unknown): value is { outcome: "failure"; error: string } {
  return Boolean(value) && typeof value === "object"
    && (value as Record<string, unknown>).outcome === "failure"
    && typeof (value as Record<string, unknown>).error === "string";
}

function failureStatus(code: string) {
  if (code === "forbidden") return 403;
  if (code === "not_found") return 404;
  if (["stale_version", "conflict", "scope_conflict"].includes(code)) return 409;
  return code === "invalid_request" ? 400 : 503;
}

function publicFailure(code: string) {
  return PROJECT_FAILURES.has(code) ? code : "project_command_unavailable";
}

export const defaultWorkstationProjectCreateDependencies: WorkstationProjectCreateDependencies = {
  loadSession: getWorkspaceSession,
  async createProject(input) {
    const client = await getSupabaseServerClient();
    const { data, error } = await client.rpc("create_current_project_v2", {
      p_name: input.name,
      p_description: input.description,
      p_category: input.category,
      p_owner_employee_public_id: input.ownerPublicId,
      p_budget_amount: input.budgetAmount,
      p_status: input.status,
      p_priority: input.priority,
      p_starts_on: input.startsOn,
      p_due_on: input.dueOn,
      p_version: input.version,
      p_reason: input.reason,
      request_id: input.requestId,
      idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data;
  },
};

export function createWorkstationProjectCreateHandler(
  dependencies: WorkstationProjectCreateDependencies,
) {
  return async function createProject(request: Request) {
    let session: ProjectCreateSession | null;
    try {
      session = await dependencies.loadSession();
    } catch {
      return json({ error: "project_command_unavailable" }, 503);
    }
    if (!session) return json({ error: "unauthorized" }, 401);
    if (!canCreateProject(session)) return json({ error: "forbidden" }, 403);
    const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
    if (!idempotencyKey) return json({ error: "invalid_idempotency_key" }, 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    const input = parseProjectCreate(body);
    if (!input) return json({ error: "invalid_request" }, 400);

    try {
      const raw = await dependencies.createProject({
        ...input,
        requestId: dependencies.createRequestId?.() ?? randomUUID(),
        idempotencyKey,
      });
      if (failure(raw)) {
        const error = publicFailure(raw.error);
        return json({ error }, failureStatus(error));
      }
      const project = success(raw);
      if (!project) return json({ error: "project_command_unavailable" }, 503);
      return json({ project }, 201);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      if (code === "42501") return json({ error: "forbidden" }, 403);
      if (code.startsWith("22")) return json({ error: "invalid_request" }, 400);
      return json({ error: "project_command_unavailable" }, 503);
    }
  };
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
