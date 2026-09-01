import type {
  ProjectDecision,
  ProjectDecisionCitation,
  ProjectExecutionTraceItem,
  ProjectOperatingModel,
  ProjectRetrospective,
  ProjectSopDefinition,
  ProjectSopRun,
  ProjectSopStep,
} from "@/features/projects/types";

type JsonRecord = Record<string, unknown>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) return null;
  return value;
}

function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseProjectSopSteps(value: unknown): ProjectSopStep[] | null {
  if (!Array.isArray(value) || value.length > 30) return null;
  const keys = new Set<string>();
  const steps = value.flatMap((item) => {
    const source = record(item);
    const key = text(source?.key, 40, true); const name = text(source?.name, 120, true);
    const description = text(source?.description, 1000); const kind = source?.kind;
    if (!key || !/^[a-z][a-z0-9_-]{0,39}$/.test(key) || keys.has(key) || !name || description === null
        || !["human", "agent", "approval", "system"].includes(String(kind))
        || typeof source?.requiresHuman !== "boolean") return [];
    keys.add(key);
    return [{ key, name, description, kind: kind as ProjectSopStep["kind"], requiresHuman: source.requiresHuman }];
  });
  return steps.length === value.length ? steps : null;
}

function parseSops(value: unknown): ProjectSopDefinition[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const parsed = value.flatMap((item) => {
    const source = record(item); if (!source) return [];
    const id = uuid(source.id); const code = text(source.code, 80, true);
    const name = text(source?.name, 160, true); const description = text(source?.description, 2000);
    const version = positiveInteger(source?.version); const updatedAt = timestamp(source?.updatedAt);
    const versionId = source?.versionId == null ? undefined : uuid(source.versionId) ?? undefined;
    const revision = source?.revision == null ? undefined : positiveInteger(source.revision) ?? undefined;
    const steps = source?.steps == null ? [] : parseProjectSopSteps(source.steps);
    if (!id || !code || !name || description === null || !version || !updatedAt || !steps
        || !["draft", "active", "retired"].includes(String(source?.status))
        || (source?.versionId != null && !versionId) || (source?.revision != null && !revision)
        || (source?.lifecycle != null && !["draft", "published", "retired"].includes(String(source.lifecycle)))) return [];
    return [{ id, code, name, description, status: source.status as ProjectSopDefinition["status"], version,
      versionId, revision, lifecycle: source.lifecycle as ProjectSopDefinition["lifecycle"], steps, updatedAt }];
  });
  return parsed.length === value.length ? parsed : null;
}

function parseSopRuns(value: unknown): ProjectSopRun[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const parsed = value.flatMap((item) => {
    const source = record(item); if (!source) return [];
    const id = uuid(source.id); const definitionId = uuid(source.definitionId);
    const versionId = uuid(source?.versionId); const assignedEmployeeId = uuid(source?.assignedEmployeeId);
    const definitionName = text(source?.definitionName, 160, true); const assignedName = text(source?.assignedName, 200, true);
    const revision = positiveInteger(source?.revision); const currentStepIndex = nonNegativeInteger(source?.currentStepIndex);
    const version = positiveInteger(source?.version); const startedAt = timestamp(source?.startedAt);
    const updatedAt = timestamp(source?.updatedAt); const steps = parseProjectSopSteps(source?.steps);
    const taskId = source?.taskId == null ? undefined : uuid(source.taskId) ?? undefined;
    const completedAt = source?.completedAt == null ? undefined : timestamp(source.completedAt) ?? undefined;
    if (!id || !definitionId || !versionId || !assignedEmployeeId || !definitionName || !assignedName || !revision
        || currentStepIndex === null || !version || !startedAt || !updatedAt || !steps
        || !["running", "waiting_human", "completed", "failed", "cancelled"].includes(String(source?.status))
        || (source?.taskId != null && !taskId) || (source?.completedAt != null && !completedAt)) return [];
    return [{ id, definitionId, definitionName, versionId, revision, steps, taskId, assignedEmployeeId,
      assignedName, status: source.status as ProjectSopRun["status"], currentStepIndex, version,
      startedAt, completedAt, updatedAt }];
  });
  return parsed.length === value.length ? parsed : null;
}

function parseCitations(value: unknown): ProjectDecisionCitation[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const parsed = value.flatMap((item) => {
    const source = record(item); if (!source) return [];
    const id = text(source.id, 500, true); const label = text(source.label, 200, true);
    if (!id || !label || !["task", "report", "knowledge", "file", "link"].includes(String(source?.type))) return [];
    return [{ type: source.type as ProjectDecisionCitation["type"], id, label }];
  });
  return parsed.length === value.length ? parsed : null;
}

function parseDecisions(value: unknown): ProjectDecision[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const parsed = value.flatMap((item) => {
    const source = record(item); if (!source) return [];
    const id = uuid(source.id); const title = text(source.title, 200, true);
    const summary = text(source?.summary, 8000, true); const citations = parseCitations(source?.citations);
    const ownerEmployeeId = uuid(source?.ownerEmployeeId); const ownerName = text(source?.ownerName, 200, true);
    const version = positiveInteger(source?.version); const createdAt = timestamp(source?.createdAt);
    const updatedAt = timestamp(source?.updatedAt);
    const acceptedAt = source?.acceptedAt == null ? undefined : timestamp(source.acceptedAt) ?? undefined;
    if (!id || !title || !summary || !citations || !ownerEmployeeId || !ownerName || !version || !createdAt || !updatedAt
        || !["decision", "risk", "lesson", "action"].includes(String(source?.type))
        || !["proposed", "accepted", "archived"].includes(String(source?.status))
        || (source?.acceptedAt != null && !acceptedAt)) return [];
    return [{ id, type: source.type as ProjectDecision["type"], title, summary, citations, ownerEmployeeId,
      ownerName, status: source.status as ProjectDecision["status"], version, createdAt, acceptedAt, updatedAt }];
  });
  return parsed.length === value.length ? parsed : null;
}

function parseRetrospective(value: unknown): ProjectRetrospective | undefined | null {
  if (value == null) return undefined;
  const source = record(value); const id = uuid(source?.id); const outcome = text(source?.outcome, 8000, true);
  const wins = text(source?.wins, 8000); const lessons = text(source?.lessons, 8000, true);
  const followUps = text(source?.followUps, 8000); const version = positiveInteger(source?.version);
  const updatedAt = timestamp(source?.updatedAt);
  if (!id || !outcome || wins === null || !lessons || followUps === null || !version || !updatedAt) return null;
  return { id, outcome, wins, lessons, followUps, updatedById: "", version, updatedAt };
}

function parseTrace(value: unknown): ProjectExecutionTraceItem[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const parsed = value.flatMap((item) => {
    const source = record(item); if (!source) return [];
    const id = uuid(source.id); const eventType = text(source.eventType, 80, true);
    const title = text(source?.title, 4000, true); const actorName = text(source?.actorName, 200, true);
    const occurredAt = timestamp(source?.occurredAt);
    const taskId = source?.taskId == null ? undefined : uuid(source.taskId) ?? undefined;
    const runId = source?.runId == null ? undefined : uuid(source.runId) ?? undefined;
    if (!id || !eventType || !title || !actorName || !occurredAt
        || !["project", "acceptance", "sop"].includes(String(source?.source))
        || (source?.taskId != null && !taskId) || (source?.runId != null && !runId)) return [];
    return [{ id, source: source.source as ProjectExecutionTraceItem["source"], eventType, title, actorName,
      occurredAt, taskId, runId }];
  });
  return parsed.length === value.length ? parsed : null;
}

export function parseProjectOperatingModel(value: unknown): ProjectOperatingModel | null {
  const source = record(value);
  if (!source || typeof source.canManage !== "boolean") return null;
  const sops = parseSops(source.sops); const sopRuns = parseSopRuns(source.sopRuns);
  const decisions = parseDecisions(source.decisions); const retrospective = parseRetrospective(source.retrospective);
  const trace = parseTrace(source.trace);
  if (!sops || !sopRuns || !decisions || retrospective === null || !trace) return null;
  return { canManage: source.canManage, sops, sopRuns, decisions, retrospective, trace };
}
