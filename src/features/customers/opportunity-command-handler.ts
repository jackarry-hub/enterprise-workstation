import { randomUUID } from "node:crypto";

import { canonicalUuid, readStrictJson } from "@/app/api/workstation/tasks/handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
type CustomerContext = { params: Promise<{ customerId: string }> };
type OpportunityContext = { params: Promise<{ opportunityId: string }> };

export type OpportunityCommandDependencies = {
  session: { member: { status: string }; permissionCodes: readonly string[] } | null;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  createRequestId?: () => string;
};

const opportunityStages = new Set(["lead", "qualified", "proposal", "won", "lost"]);
const followUpKinds = new Set(["call", "meeting", "email", "message", "visit", "note"]);
const projectStatuses = new Set(["planning", "active"]);
const projectPriorities = new Set(["low", "medium", "high", "critical"]);
const publicFailures = new Set([
  "forbidden", "not_found", "stale_version", "conflict", "scope_conflict",
  "invalid_request", "invalid_stage", "already_converted", "project_unavailable",
]);
const MONEY_PATTERN = /^(0|[1-9]\d{0,15})(?:\.(\d{1,2}))?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  return parsed.length <= maximum && (!required || parsed.length > 0) ? parsed : null;
}

function nullableText(value: unknown, maximum: number, minimum = 1) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const parsed = value.trim();
  return parsed.length >= minimum && parsed.length <= maximum ? parsed : undefined;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function money(value: unknown) {
  if (typeof value !== "string") return null;
  const match = MONEY_PATTERN.exec(value.trim());
  return match ? `${match[1]}.${(match[2] ?? "").padEnd(2, "0")}` : null;
}

function date(value: unknown, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") return undefined;
  const match = DATE_PATTERN.exec(value);
  if (!match) return undefined;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? value : undefined;
}

function timestamp(value: unknown, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") return undefined;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second, offsetHour = 0, offsetMinute = 0] =
    match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return undefined;
  }
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function initialGuard(dependencies: OpportunityCommandDependencies) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (dependencies.session.member.status !== "active"
    || !dependencies.session.permissionCodes.includes("customer.manage")) {
    return json({ error: "forbidden" }, 403);
  }
  return null;
}

async function strictBody(request: Request) {
  const parsed = await readStrictJson(request);
  if (!parsed.ok) {
    const status = parsed.error === "unsupported_media_type" ? 415
      : parsed.error === "payload_too_large" ? 413 : 400;
    return { ok: false, response: json({ error: parsed.error }, status) } as const;
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return { ok: false, response: json({ error: "invalid_request" }, 400) } as const;
  }
  return { ok: true, value: parsed.value as Record<string, unknown> } as const;
}

function commandIds(request: Request, dependencies: OpportunityCommandDependencies) {
  const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
  return idempotencyKey ? {
    request_id: dependencies.createRequestId?.() ?? randomUUID(),
    idempotency_key: idempotencyKey,
  } : null;
}

function failureStatus(error: string) {
  if (error === "forbidden") return 403;
  if (error === "not_found") return 404;
  if (error === "invalid_stage") return 422;
  if (["stale_version", "conflict", "scope_conflict", "already_converted"].includes(error)) return 409;
  return error === "invalid_request" ? 400 : 503;
}

async function invoke(
  name: string,
  args: Record<string, unknown>,
  dependencies: OpportunityCommandDependencies,
) {
  try {
    const result = await dependencies.rpc(name, args);
    if (result.error) {
      if (result.error.code === "42501") return json({ error: "forbidden" }, 403);
      if (result.error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
      return json({ error: "opportunity_command_unavailable" }, 503);
    }
    const row = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as Record<string, unknown> : null;
    if (row?.outcome === "failure" && typeof row.error === "string") {
      if (!exactKeys(row, ["outcome", "error"])) {
        return json({ error: "opportunity_command_unavailable" }, 503);
      }
      const error = publicFailures.has(row.error) ? row.error : "opportunity_command_unavailable";
      return json({ error }, failureStatus(error));
    }
    if (row?.outcome !== "success"
      || !exactKeys(row, ["outcome", "resource", "id", "version", "entity"])) {
      return json({ error: "opportunity_command_unavailable" }, 503);
    }
    return row;
  } catch {
    return json({ error: "opportunity_command_unavailable" }, 503);
  }
}

type OpportunityExpectation = {
  customerId?: string;
  opportunityId?: string;
  ownerEmployeePublicId?: string;
  name?: string;
  stage?: string;
  amount?: string;
  currency?: string;
  expectedCloseOn?: string | null;
  lossReason?: string | null;
  version?: number;
};

function canonicalOpportunity(result: Record<string, unknown>, expected: OpportunityExpectation) {
  if (result.resource !== "opportunity") return null;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  if (!entity || !exactKeys(entity, [
    "id", "customerId", "ownerEmployeePublicId", "name", "stage", "amount", "currency",
    "expectedCloseOn", "lossReason", "version", "createdAt", "updatedAt", "archivedAt",
  ])) return null;
  const id = canonicalUuid(entity.id);
  const topId = canonicalUuid(result.id);
  const entityCustomerId = canonicalUuid(entity.customerId);
  const ownerEmployeePublicId = canonicalUuid(entity.ownerEmployeePublicId);
  const name = text(entity.name, 160, true);
  const stage = typeof entity.stage === "string" && opportunityStages.has(entity.stage) ? entity.stage : null;
  const amount = money(entity.amount);
  const currency = typeof entity.currency === "string" && /^[A-Z]{3}$/.test(entity.currency)
    ? entity.currency : null;
  const expectedCloseOn = date(entity.expectedCloseOn, true);
  const lossReason = nullableText(entity.lossReason, 1000);
  const version = positiveInteger(entity.version);
  const topVersion = positiveInteger(result.version);
  const createdAt = timestamp(entity.createdAt);
  const updatedAt = timestamp(entity.updatedAt);
  const archivedAt = timestamp(entity.archivedAt, true);
  if (!id || topId !== id || (expected.opportunityId && id !== expected.opportunityId) || !entityCustomerId
    || (expected.customerId && entityCustomerId !== expected.customerId)
    || !ownerEmployeePublicId || !name || !stage
    || !amount || !currency || expectedCloseOn === undefined || lossReason === undefined
    || (stage === "lost" ? !lossReason : lossReason !== null) || !version || topVersion !== version
    || !createdAt || !updatedAt || archivedAt === undefined) return null;
  if ((expected.ownerEmployeePublicId !== undefined
      && ownerEmployeePublicId !== expected.ownerEmployeePublicId)
    || (expected.name !== undefined && name !== expected.name)
    || (expected.stage !== undefined && stage !== expected.stage)
    || (expected.amount !== undefined && amount !== expected.amount)
    || (expected.currency !== undefined && currency !== expected.currency)
    || ("expectedCloseOn" in expected && expectedCloseOn !== expected.expectedCloseOn)
    || ("lossReason" in expected && lossReason !== expected.lossReason)
    || (expected.version !== undefined && version !== expected.version)) return null;
  return { id, customerId: entityCustomerId, ownerEmployeePublicId, name, stage, amount, currency,
    expectedCloseOn, lossReason, version, createdAt, updatedAt, archivedAt };
}

function canonicalFollowUp(result: Record<string, unknown>, expected: {
  customerId: string;
  opportunityId: string | null;
  kind: string;
  content: string;
  nextFollowUpAt: string | null;
}) {
  if (result.resource !== "customer_follow_up" || result.version !== 1) return null;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  if (!entity || !exactKeys(entity, [
    "id", "customerId", "opportunityId", "actorEmployeePublicId", "kind", "content",
    "occurredAt", "nextFollowUpAt",
  ])) return null;
  const id = canonicalUuid(entity.id);
  const topId = canonicalUuid(result.id);
  const entityCustomerId = canonicalUuid(entity.customerId);
  const opportunityId = entity.opportunityId === null ? null : canonicalUuid(entity.opportunityId);
  const actorEmployeePublicId = canonicalUuid(entity.actorEmployeePublicId);
  const kind = typeof entity.kind === "string" && followUpKinds.has(entity.kind) ? entity.kind : null;
  const content = text(entity.content, 8000, true);
  const occurredAt = timestamp(entity.occurredAt);
  const nextFollowUpAt = timestamp(entity.nextFollowUpAt, true);
  const nextTimeMatches = nextFollowUpAt === null && expected.nextFollowUpAt === null
    || typeof nextFollowUpAt === "string" && typeof expected.nextFollowUpAt === "string"
      && Date.parse(nextFollowUpAt) === Date.parse(expected.nextFollowUpAt);
  if (!id || topId !== id || entityCustomerId !== expected.customerId
    || (entity.opportunityId !== null && !opportunityId) || !actorEmployeePublicId || !kind
    || !content || !occurredAt || nextFollowUpAt === undefined
    || (nextFollowUpAt !== null && Date.parse(nextFollowUpAt) < Date.parse(occurredAt))
    || opportunityId !== expected.opportunityId || kind !== expected.kind
    || content !== expected.content || !nextTimeMatches) return null;
  return { id, customerId: expected.customerId, opportunityId, actorEmployeePublicId, kind, content,
    occurredAt, nextFollowUpAt };
}

function canonicalConversion(
  result: Record<string, unknown>,
  opportunityId: string,
  expectedOpportunityVersion: number,
) {
  if (result.resource !== "opportunity_conversion") return null;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  if (!entity || !exactKeys(entity, [
    "opportunityId", "opportunityVersion", "projectId", "projectVersion", "customerProjectLinkId",
  ])) return null;
  const topId = canonicalUuid(result.id);
  const entityOpportunityId = canonicalUuid(entity.opportunityId);
  const projectId = canonicalUuid(entity.projectId);
  const customerProjectLinkId = canonicalUuid(entity.customerProjectLinkId);
  const opportunityVersion = positiveInteger(entity.opportunityVersion);
  const projectVersion = positiveInteger(entity.projectVersion);
  const topVersion = positiveInteger(result.version);
  if (topId !== opportunityId || entityOpportunityId !== opportunityId || !projectId
    || !customerProjectLinkId || !opportunityVersion || topVersion !== opportunityVersion
    || opportunityVersion !== expectedOpportunityVersion || projectVersion !== 1
    || new Set([opportunityId, projectId, customerProjectLinkId]).size !== 3) return null;
  return { opportunityId, opportunityVersion, projectId, projectVersion, customerProjectLinkId };
}

export async function handleOpportunityCreateCommand(
  request: Request,
  context: CustomerContext,
  dependencies: OpportunityCommandDependencies,
) {
  const guard = initialGuard(dependencies);
  if (guard) return guard;
  const customerId = canonicalUuid((await context.params).customerId);
  const ids = commandIds(request, dependencies);
  if (!customerId) return json({ error: "invalid_request" }, 400);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await strictBody(request);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, [
    "name", "ownerEmployeePublicId", "amount", "currency", "expectedCloseOn", "version", "reason",
  ])) return json({ error: "invalid_request" }, 400);
  const name = text(body.value.name, 160, true);
  const ownerEmployeePublicId = canonicalUuid(body.value.ownerEmployeePublicId);
  const amount = money(body.value.amount);
  const currency = typeof body.value.currency === "string" && /^[A-Z]{3}$/.test(body.value.currency)
    ? body.value.currency : null;
  const expectedCloseOn = date(body.value.expectedCloseOn, true);
  const reason = text(body.value.reason, 500, true);
  if (!name || !ownerEmployeePublicId || !amount || !currency || expectedCloseOn === undefined
    || body.value.version !== 0 || !reason) return json({ error: "invalid_request" }, 400);
  const result = await invoke("create_current_opportunity", {
    p_customer_public_id: customerId, p_name: name,
    p_owner_employee_public_id: ownerEmployeePublicId, p_amount: amount,
    p_currency: currency, p_expected_close_on: expectedCloseOn,
    p_version: 0, p_reason: reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const opportunity = canonicalOpportunity(result, {
    customerId, ownerEmployeePublicId, name, stage: "lead", amount, currency,
    expectedCloseOn, lossReason: null, version: 1,
  });
  return opportunity ? json({ outcome: "success", resource: "opportunity", opportunity }, 201)
    : json({ error: "opportunity_command_unavailable" }, 503);
}

export async function handleOpportunityTransitionCommand(
  request: Request,
  context: OpportunityContext,
  dependencies: OpportunityCommandDependencies,
) {
  const guard = initialGuard(dependencies);
  if (guard) return guard;
  const opportunityId = canonicalUuid((await context.params).opportunityId);
  const ids = commandIds(request, dependencies);
  if (!opportunityId) return json({ error: "invalid_request" }, 400);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await strictBody(request);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, ["stage", "lossReason", "expectedVersion", "reason"])) {
    return json({ error: "invalid_request" }, 400);
  }
  const stage = typeof body.value.stage === "string" && opportunityStages.has(body.value.stage)
    ? body.value.stage : null;
  const lossReason = nullableText(body.value.lossReason, 1000);
  const expectedVersion = positiveInteger(body.value.expectedVersion);
  const reason = text(body.value.reason, 500, true);
  if (!stage || stage === "lead" || lossReason === undefined || !expectedVersion
    || expectedVersion >= Number.MAX_SAFE_INTEGER || !reason
    || (stage === "lost" ? !lossReason : lossReason !== null)) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await invoke("transition_current_opportunity_stage", {
    p_opportunity_public_id: opportunityId, p_stage: stage, p_loss_reason: lossReason,
    p_expected_version: expectedVersion, p_reason: reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const opportunity = canonicalOpportunity(result, {
    opportunityId, stage, lossReason, version: expectedVersion + 1,
  });
  return opportunity ? json({ outcome: "success", resource: "opportunity", opportunity })
    : json({ error: "opportunity_command_unavailable" }, 503);
}

export async function handleCustomerFollowUpCreateCommand(
  request: Request,
  context: CustomerContext,
  dependencies: OpportunityCommandDependencies,
) {
  const guard = initialGuard(dependencies);
  if (guard) return guard;
  const customerId = canonicalUuid((await context.params).customerId);
  const ids = commandIds(request, dependencies);
  if (!customerId) return json({ error: "invalid_request" }, 400);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await strictBody(request);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, [
    "opportunityId", "kind", "content", "nextFollowUpAt", "version", "reason",
  ])) return json({ error: "invalid_request" }, 400);
  const opportunityId = body.value.opportunityId === null ? null : canonicalUuid(body.value.opportunityId);
  const kind = typeof body.value.kind === "string" && followUpKinds.has(body.value.kind)
    ? body.value.kind : null;
  const content = text(body.value.content, 8000, true);
  const nextFollowUpAt = timestamp(body.value.nextFollowUpAt, true);
  const reason = text(body.value.reason, 500, true);
  if ((body.value.opportunityId !== null && !opportunityId) || !kind || !content
    || nextFollowUpAt === undefined || body.value.version !== 0 || !reason) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await invoke("create_current_customer_follow_up", {
    p_customer_public_id: customerId, p_opportunity_public_id: opportunityId,
    p_kind: kind, p_content: content, p_next_follow_up_at: nextFollowUpAt,
    p_version: 0, p_reason: reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const followUp = canonicalFollowUp(result, {
    customerId, opportunityId, kind, content, nextFollowUpAt,
  });
  return followUp ? json({ outcome: "success", resource: "customer_follow_up", followUp }, 201)
    : json({ error: "opportunity_command_unavailable" }, 503);
}

export async function handleOpportunityConvertCommand(
  request: Request,
  context: OpportunityContext,
  dependencies: OpportunityCommandDependencies,
) {
  const guard = initialGuard(dependencies);
  if (guard) return guard;
  const opportunityId = canonicalUuid((await context.params).opportunityId);
  const ids = commandIds(request, dependencies);
  if (!opportunityId) return json({ error: "invalid_request" }, 400);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await strictBody(request);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, [
    "projectName", "description", "category", "status", "priority", "startsOn", "dueOn",
    "expectedVersion", "reason",
  ])) return json({ error: "invalid_request" }, 400);
  const projectName = text(body.value.projectName, 160, true);
  const description = text(body.value.description, 4000);
  const category = text(body.value.category, 80, true);
  const status = typeof body.value.status === "string" && projectStatuses.has(body.value.status)
    ? body.value.status : null;
  const priority = typeof body.value.priority === "string" && projectPriorities.has(body.value.priority)
    ? body.value.priority : null;
  const startsOn = date(body.value.startsOn);
  const dueOn = date(body.value.dueOn);
  const expectedVersion = positiveInteger(body.value.expectedVersion);
  const reason = text(body.value.reason, 500, true);
  if (!projectName || description === null || !category || !status || !priority || !startsOn
    || !dueOn || dueOn < startsOn || !expectedVersion
    || expectedVersion >= Number.MAX_SAFE_INTEGER || !reason) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await invoke("convert_current_opportunity_to_project", {
    p_opportunity_public_id: opportunityId, p_project_name: projectName,
    p_description: description, p_category: category, p_status: status,
    p_priority: priority, p_starts_on: startsOn, p_due_on: dueOn,
    p_expected_version: expectedVersion, p_reason: reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const conversion = canonicalConversion(result, opportunityId, expectedVersion + 1);
  return conversion ? json({ outcome: "success", resource: "opportunity_conversion", conversion }, 201)
    : json({ error: "opportunity_command_unavailable" }, 503);
}

export async function defaultOpportunityCommandDependencies(): Promise<OpportunityCommandDependencies> {
  const session = await getWorkspaceSession();
  const client = await getSupabaseServerClient();
  return { session, async rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    return { data, error };
  } };
}
