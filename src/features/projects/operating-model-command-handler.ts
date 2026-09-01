import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { parseProjectSopSteps } from "@/features/projects/data/project-operating-model-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type JsonRecord = Record<string, unknown>;
type Context = { params: Promise<{ projectId: string }> };
type RpcResult = { data: unknown; error: { code?: string } | null };

export type OperatingModelCommandDependencies = {
  session: { member: { status: string } } | null;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  createRequestId?: () => string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 65_536;
const publicFailures = new Set([
  "forbidden", "not_found", "conflict", "scope_conflict", "stale_version", "invalid_state", "invalid_request",
]);

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string" || value.length > maximum) return null;
  const parsed = value.trim();
  return required && !parsed ? null : parsed;
}

function positiveInteger(value: unknown, allowZero = false) {
  return typeof value === "number" && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0) ? value : null;
}

function exactKeys(value: JsonRecord, expected: readonly string[]) {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

async function body(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return null;
    return record(JSON.parse(raw));
  } catch { return null; }
}

function statusFor(code: string) {
  if (code === "forbidden") return 403;
  if (code === "not_found") return 404;
  if (["conflict", "scope_conflict", "stale_version", "invalid_state"].includes(code)) return 409;
  if (code === "invalid_request") return 400;
  return 503;
}

type ParsedCommand = { rpc: string; resource: string; args: JsonRecord };

function parseCitations(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const citations = value.flatMap((item) => {
    const source = record(item); const id = text(source?.id, 500, true); const label = text(source?.label, 200, true);
    if (!source || !exactKeys(source, ["type", "id", "label"]) || !id || !label
        || !["task", "report", "knowledge", "file", "link"].includes(String(source.type))) return [];
    return [{ type: source.type, id, label }];
  });
  return citations.length === value.length ? citations : null;
}

function parseCommand(value: JsonRecord, projectId: string): ParsedCommand | null {
  const command = value.command;
  if (command === "save_sop") {
    if (!exactKeys(value, ["command", "definitionId", "code", "name", "description", "steps", "publish", "reason"])) return null;
    const definitionId = value.definitionId === null ? null : uuid(value.definitionId);
    const code = text(value.code, 80, true); const name = text(value.name, 160, true);
    const description = text(value.description, 2000); const steps = parseProjectSopSteps(value.steps);
    const reason = text(value.reason, 500, true);
    if (definitionId === undefined || (value.definitionId !== null && !definitionId) || !code
        || !/^[a-z][a-z0-9_-]{1,79}$/.test(code) || !name || description === null || !steps
        || steps.length === 0 || typeof value.publish !== "boolean" || !reason) return null;
    return { rpc: "save_current_project_sop", resource: "sop_definition", args: {
      p_project_public_id: projectId, p_definition_public_id: definitionId, p_code: code, p_name: name,
      p_description: description, p_steps: steps, p_publish: value.publish, p_reason: reason,
    } };
  }
  if (command === "start_sop") {
    if (!exactKeys(value, ["command", "definitionId", "taskId", "assignedEmployeeId", "reason"])) return null;
    const definitionId = uuid(value.definitionId); const assignedEmployeeId = uuid(value.assignedEmployeeId);
    const taskId = value.taskId === null ? null : uuid(value.taskId); const reason = text(value.reason, 500, true);
    if (!definitionId || !assignedEmployeeId || (value.taskId !== null && !taskId) || !reason) return null;
    return { rpc: "start_current_project_sop_run", resource: "sop_run", args: {
      p_project_public_id: projectId, p_definition_public_id: definitionId, p_task_public_id: taskId,
      p_assigned_employee_public_id: assignedEmployeeId, p_reason: reason,
    } };
  }
  if (command === "advance_sop") {
    if (!exactKeys(value, ["command", "runId", "action", "expectedVersion", "note", "evidence", "reason"])) return null;
    const runId = uuid(value.runId); const expectedVersion = positiveInteger(value.expectedVersion);
    const note = text(value.note, 2000); const evidence = record(value.evidence); const reason = text(value.reason, 500, true);
    if (!runId || !["complete_step", "request_human", "resume", "fail", "cancel"].includes(String(value.action))
        || !expectedVersion || note === null || !evidence || JSON.stringify(evidence).length > 32_768 || !reason) return null;
    return { rpc: "advance_current_project_sop_run", resource: "sop_run", args: {
      p_run_public_id: runId, p_action: value.action, p_expected_version: expectedVersion,
      p_note: note, p_evidence: evidence, p_reason: reason,
    } };
  }
  if (command === "record_decision") {
    if (!exactKeys(value, ["command", "type", "title", "summary", "citations", "ownerEmployeeId", "reason"])) return null;
    const title = text(value.title, 200, true); const summary = text(value.summary, 8000, true);
    const citations = parseCitations(value.citations); const ownerEmployeeId = uuid(value.ownerEmployeeId);
    const reason = text(value.reason, 500, true);
    if (!["decision", "risk", "lesson", "action"].includes(String(value.type)) || !title || !summary
        || !citations || citations.length === 0 || !ownerEmployeeId || !reason) return null;
    return { rpc: "record_current_project_decision", resource: "project_decision", args: {
      p_project_public_id: projectId, p_decision_type: value.type, p_title: title, p_summary: summary,
      p_citations: citations, p_owner_employee_public_id: ownerEmployeeId, p_reason: reason,
    } };
  }
  if (command === "transition_decision") {
    if (!exactKeys(value, ["command", "decisionId", "status", "expectedVersion", "reason"])) return null;
    const decisionId = uuid(value.decisionId); const expectedVersion = positiveInteger(value.expectedVersion);
    const reason = text(value.reason, 500, true);
    if (!decisionId || !["accepted", "archived"].includes(String(value.status)) || !expectedVersion || !reason) return null;
    return { rpc: "transition_current_project_decision", resource: "project_decision", args: {
      p_decision_public_id: decisionId, p_status: value.status, p_expected_version: expectedVersion, p_reason: reason,
    } };
  }
  if (command === "save_retrospective") {
    if (!exactKeys(value, ["command", "outcome", "wins", "lessons", "followUps", "expectedVersion", "reason"])) return null;
    const outcome = text(value.outcome, 8000, true); const wins = text(value.wins, 8000);
    const lessons = text(value.lessons, 8000, true); const followUps = text(value.followUps, 8000);
    const expectedVersion = positiveInteger(value.expectedVersion, true); const reason = text(value.reason, 500, true);
    if (!outcome || wins === null || !lessons || followUps === null || expectedVersion === null || !reason) return null;
    return { rpc: "save_current_project_retrospective", resource: "project_retrospective", args: {
      p_project_public_id: projectId, p_outcome: outcome, p_wins: wins, p_lessons: lessons,
      p_follow_ups: followUps, p_expected_version: expectedVersion, p_reason: reason,
    } };
  }
  if (command === "update_risk") {
    if (!exactKeys(value, ["command", "riskId", "status", "expectedVersion", "reason"])) return null;
    const riskId = uuid(value.riskId); const expectedVersion = positiveInteger(value.expectedVersion);
    const reason = text(value.reason, 500, true);
    if (!riskId || !["open", "monitoring", "mitigated", "closed"].includes(String(value.status))
        || !expectedVersion || !reason) return null;
    return { rpc: "update_current_project_risk_status", resource: "risk", args: {
      p_risk_public_id: riskId, p_status: value.status, p_expected_version: expectedVersion, p_reason: reason,
    } };
  }
  return null;
}

function validateResult(value: unknown, command: ParsedCommand, projectId: string) {
  const result = record(value);
  if (result?.outcome === "failure" && typeof result.error === "string") return { error: result.error } as const;
  const entity = record(result?.entity); const id = uuid(result?.id); const entityId = uuid(entity?.id);
  const version = positiveInteger(result?.version); const entityVersion = positiveInteger(entity?.version);
  const responseProjectId = uuid(entity?.projectId);
  if (result?.outcome !== "success" || result.resource !== command.resource || !id || entityId !== id
      || !version || entityVersion !== version || responseProjectId !== projectId) return null;
  return { entity: { ...entity, id, projectId, version } } as const;
}

export function createOperatingModelCommandHandler(dependencies: OperatingModelCommandDependencies) {
  return async function handle(request: Request, context: Context) {
    if (!dependencies.session) return json({ error: "unauthorized" }, 401);
    if (dependencies.session.member.status !== "active") return json({ error: "forbidden" }, 403);
    const projectId = uuid((await context.params).projectId);
    const idempotencyKey = uuid(request.headers.get("Idempotency-Key"));
    if (!projectId || !idempotencyKey) return json({ error: "invalid_request" }, 400);
    const parsedBody = await body(request);
    const command = parsedBody ? parseCommand(parsedBody, projectId) : null;
    if (!command) return json({ error: "invalid_request" }, 400);
    try {
      const result = await dependencies.rpc(command.rpc, {
        ...command.args,
        request_id: dependencies.createRequestId?.() ?? randomUUID(),
        idempotency_key: idempotencyKey,
      });
      if (result.error) {
        if (result.error.code === "42501") return json({ error: "forbidden" }, 403);
        if (result.error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
        return json({ error: "operating_model_unavailable" }, 503);
      }
      const validated = validateResult(result.data, command, projectId);
      if (!validated) return json({ error: "operating_model_unavailable" }, 503);
      if ("error" in validated) {
        const failure = typeof validated.error === "string" ? validated.error : "operating_model_unavailable";
        const code = publicFailures.has(failure) ? failure : "operating_model_unavailable";
        return json({ error: code }, statusFor(code));
      }
      return json({ resource: command.resource, entity: validated.entity });
    } catch { return json({ error: "operating_model_unavailable" }, 503); }
  };
}

export async function handleDefaultOperatingModelCommand(request: Request, context: Context) {
  try {
    const session = await getWorkspaceSession(); const client = await getSupabaseServerClient();
    return createOperatingModelCommandHandler({ session, rpc: async (name, args) => {
      const result = await client.rpc(name, args); return { data: result.data, error: result.error };
    } })(request, context);
  } catch { return json({ error: "operating_model_unavailable" }, 503); }
}
