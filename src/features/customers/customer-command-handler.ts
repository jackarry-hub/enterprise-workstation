import { randomUUID } from "node:crypto";

import { readStrictJson, canonicalUuid } from "@/app/api/workstation/tasks/handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
type CustomerContext = { params: Promise<{ customerId: string }> };

export type CustomerCommandDependencies = {
  session: { member: { status: string }; permissionCodes: readonly string[] } | null;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  createRequestId?: () => string;
};

const sources = new Set(["consulting", "referral", "event", "outbound", "other"]);
const statuses = new Set(["lead", "following", "proposal", "negotiating", "won", "lost"]);
const contactVisibilities = new Set(["assigned", "managers"]);
const publicFailures = new Set([
  "forbidden", "not_found", "stale_version", "conflict", "scope_conflict", "invalid_request",
  "already_archived", "not_archived", "ownership_transfer_required", "owner_unavailable",
]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

function safeSourceUrl(value: string) {
  try {
    const parsed = new URL(value);
    const sensitive = new Set(["token", "access_token", "key", "api_key", "signature", "sig", "auth", "password", "secret"]);
    return /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?:[/?]|$)/.test(value)
      && parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password
      && !value.includes("#") && !/[?&][^=&#]*%[^=&#]*=/.test(value)
      && ![...parsed.searchParams.keys()].some((key) => sensitive.has(key.toLowerCase()));
  } catch {
    return false;
  }
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

function allowed(dependencies: CustomerCommandDependencies) {
  return dependencies.session?.member.status === "active"
    && dependencies.session.permissionCodes.includes("customer.manage");
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

function commandIds(request: Request, dependencies: CustomerCommandDependencies) {
  const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
  if (!idempotencyKey) return null;
  return {
    request_id: dependencies.createRequestId?.() ?? randomUUID(),
    idempotency_key: idempotencyKey,
  };
}

function failureStatus(error: string) {
  if (error === "forbidden") return 403;
  if (error === "not_found") return 404;
  if (["stale_version", "conflict", "scope_conflict", "already_archived", "not_archived",
    "ownership_transfer_required", "owner_unavailable"].includes(error)) return 409;
  return error === "invalid_request" ? 400 : 503;
}

async function invoke(
  name: string,
  args: Record<string, unknown>,
  dependencies: CustomerCommandDependencies,
) {
  try {
    const result = await dependencies.rpc(name, args);
    if (result.error) {
      if (result.error.code === "42501") return json({ error: "forbidden" }, 403);
      if (result.error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
      return json({ error: "customer_command_unavailable" }, 503);
    }
    const row = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as Record<string, unknown> : null;
    if (row?.outcome === "failure" && typeof row.error === "string") {
      if (!exactKeys(row, ["outcome", "error"])) {
        return json({ error: "customer_command_unavailable" }, 503);
      }
      const error = publicFailures.has(row.error) ? row.error : "customer_command_unavailable";
      return json({ error }, failureStatus(error));
    }
    if (row?.outcome !== "success" || !exactKeys(row, ["outcome", "resource", "id", "version", "entity"])) {
      return json({ error: "customer_command_unavailable" }, 503);
    }
    return row;
  } catch {
    return json({ error: "customer_command_unavailable" }, 503);
  }
}

function canonicalCustomer(result: Record<string, unknown>, expectedId?: string) {
  if (result.resource !== "customer") return null;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  if (!entity || !exactKeys(entity, [
    "id", "version", "ownerEmployeePublicId", "name", "registrationCode", "industry",
    "source", "region", "status", "updatedAt", "archivedAt",
  ])) return null;
  const id = canonicalUuid(entity?.id);
  const topId = canonicalUuid(result.id);
  const version = positiveInteger(entity?.version);
  const topVersion = positiveInteger(result.version);
  const ownerEmployeePublicId = canonicalUuid(entity?.ownerEmployeePublicId);
  const name = text(entity?.name, 160, true);
  const registrationCode = nullableText(entity?.registrationCode, 80);
  const industry = text(entity?.industry, 80, true);
  const source = typeof entity?.source === "string" && sources.has(entity.source) ? entity.source : null;
  const region = text(entity?.region, 120);
  const status = typeof entity?.status === "string" && statuses.has(entity.status) ? entity.status : null;
  const updatedAt = timestamp(entity?.updatedAt);
  const archivedAt = timestamp(entity?.archivedAt, true);
  if (!id || topId !== id || (expectedId && id !== expectedId) || !version || topVersion !== version
    || !ownerEmployeePublicId || !name || registrationCode === undefined || !industry || !source
    || region === null || !status || !updatedAt || archivedAt === undefined) return null;
  return { id, version, ownerEmployeePublicId, name, registrationCode, industry,
    source, region, status, updatedAt, archivedAt };
}

function canonicalContact(result: Record<string, unknown>, customerId: string) {
  if (result.resource !== "customer_contact") return null;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  if (!entity || !exactKeys(entity, [
    "id", "customerId", "version", "name", "title", "phone", "email", "visibility",
    "isPrimary", "createdAt", "updatedAt",
  ])) return null;
  const id = canonicalUuid(entity?.id);
  const topId = canonicalUuid(result.id);
  const resultCustomerId = canonicalUuid(entity?.customerId);
  const version = positiveInteger(entity?.version);
  const topVersion = positiveInteger(result.version);
  const name = text(entity?.name, 120, true);
  const title = text(entity?.title, 120);
  const phone = nullableText(entity?.phone, 80);
  const email = nullableText(entity?.email, 320, 3);
  const visibility = typeof entity?.visibility === "string" && contactVisibilities.has(entity.visibility)
    ? entity.visibility : null;
  const createdAt = timestamp(entity?.createdAt);
  const updatedAt = timestamp(entity?.updatedAt);
  if (!id || topId !== id || resultCustomerId !== customerId || !version || topVersion !== version
    || !name || title === null || phone === undefined || email === undefined || !visibility
    || (!phone && !email) || (email !== null && !EMAIL_PATTERN.test(email))
    || typeof entity?.isPrimary !== "boolean" || !createdAt || !updatedAt) return null;
  return { id, customerId, version, name, title, phone, email, visibility,
    isPrimary: entity.isPrimary, createdAt, updatedAt };
}

function parseCustomer(value: Record<string, unknown>, update: boolean) {
  const expected = update
    ? ["name", "registrationCode", "ownerEmployeePublicId", "industry", "source", "region", "status", "expectedVersion", "reason"]
    : ["name", "registrationCode", "ownerEmployeePublicId", "industry", "source", "region", "status", "version", "reason"];
  if (!exactKeys(value, expected)) return null;
  const name = text(value.name, 160, true);
  const registrationCode = nullableText(value.registrationCode, 80);
  const ownerEmployeePublicId = canonicalUuid(value.ownerEmployeePublicId);
  const industry = text(value.industry, 80, true);
  const source = typeof value.source === "string" && sources.has(value.source) ? value.source : null;
  const region = text(value.region, 120);
  const status = typeof value.status === "string" && statuses.has(value.status) ? value.status : null;
  const reason = text(value.reason, 500, true);
  const version = update ? positiveInteger(value.expectedVersion) : value.version === 0 ? 0 : null;
  if (!name || registrationCode === undefined || !ownerEmployeePublicId || !industry || !source
    || region === null || !status || !reason || version === null) return null;
  return { name, registrationCode, ownerEmployeePublicId, industry, source, region, status, reason, version };
}

function initialGuard(dependencies: CustomerCommandDependencies) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (!allowed(dependencies)) return json({ error: "forbidden" }, 403);
  return null;
}

export async function handleCustomerCreateCommand(
  request: Request,
  dependencies: CustomerCommandDependencies,
) {
  const guard = initialGuard(dependencies);
  if (guard) return guard;
  const ids = commandIds(request, dependencies);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await strictBody(request);
  if (!body.ok) return body.response;
  const input = parseCustomer(body.value, false);
  if (!input) return json({ error: "invalid_request" }, 400);
  const result = await invoke("create_current_customer", {
    p_name: input.name, p_registration_code: input.registrationCode,
    p_owner_employee_public_id: input.ownerEmployeePublicId,
    p_industry: input.industry, p_source: input.source, p_region: input.region,
    p_status: input.status, p_version: input.version, p_reason: input.reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const customer = canonicalCustomer(result);
  return customer ? json({ outcome: "success", resource: "customer", customer }, 201)
    : json({ error: "customer_command_unavailable" }, 503);
}

export async function handleCustomerUpdateCommand(
  request: Request,
  context: CustomerContext,
  dependencies: CustomerCommandDependencies,
) {
  const guard = initialGuard(dependencies);
  if (guard) return guard;
  const customerId = canonicalUuid((await context.params).customerId);
  const ids = commandIds(request, dependencies);
  if (!customerId) return json({ error: "invalid_request" }, 400);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await strictBody(request);
  if (!body.ok) return body.response;
  const input = parseCustomer(body.value, true);
  if (!input) return json({ error: "invalid_request" }, 400);
  const result = await invoke("update_current_customer", {
    p_customer_public_id: customerId, p_name: input.name,
    p_registration_code: input.registrationCode,
    p_owner_employee_public_id: input.ownerEmployeePublicId,
    p_industry: input.industry, p_source: input.source, p_region: input.region,
    p_status: input.status, p_expected_version: input.version, p_reason: input.reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const customer = canonicalCustomer(result, customerId);
  return customer ? json({ outcome: "success", resource: "customer", customer })
    : json({ error: "customer_command_unavailable" }, 503);
}

export async function handleCustomerContactCreateCommand(
  request: Request,
  context: CustomerContext,
  dependencies: CustomerCommandDependencies,
) {
  const guard = initialGuard(dependencies);
  if (guard) return guard;
  const customerId = canonicalUuid((await context.params).customerId);
  const ids = commandIds(request, dependencies);
  if (!customerId) return json({ error: "invalid_request" }, 400);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await strictBody(request);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, ["name", "title", "phone", "email", "visibility", "isPrimary", "version", "reason"])) {
    return json({ error: "invalid_request" }, 400);
  }
  const name = text(body.value.name, 120, true);
  const title = text(body.value.title, 120);
  const phone = nullableText(body.value.phone, 80);
  const email = nullableText(body.value.email, 320, 3);
  const visibility = typeof body.value.visibility === "string" && contactVisibilities.has(body.value.visibility)
    ? body.value.visibility : null;
  const reason = text(body.value.reason, 500, true);
  if (!name || title === null || phone === undefined || email === undefined
    || (!phone && !email) || (email && !EMAIL_PATTERN.test(email)) || !visibility
    || typeof body.value.isPrimary !== "boolean" || body.value.version !== 0 || !reason) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await invoke("create_current_customer_contact", {
    p_customer_public_id: customerId, p_name: name, p_title: title,
    p_phone: phone, p_email: email, p_visibility: visibility,
    p_is_primary: body.value.isPrimary, p_version: 0, p_reason: reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const contact = canonicalContact(result, customerId);
  return contact ? json({ outcome: "success", resource: "customer_contact", contact }, 201)
    : json({ error: "customer_command_unavailable" }, 503);
}

function canonicalTransfer(result: Record<string, unknown>, customerId: string, ownerId: string, version: number) {
  if (result.resource !== "customer_transfer") return null;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  if (!entity || !exactKeys(entity, [
    "id", "version", "ownerEmployeePublicId", "previousOwnerEmployeePublicId", "updatedAt",
  ])) return null;
  const id = canonicalUuid(entity.id);
  const topId = canonicalUuid(result.id);
  const nextOwner = canonicalUuid(entity.ownerEmployeePublicId);
  const previousOwner = canonicalUuid(entity.previousOwnerEmployeePublicId);
  const nextVersion = positiveInteger(entity.version);
  const topVersion = positiveInteger(result.version);
  const updatedAt = timestamp(entity.updatedAt);
  if (id !== customerId || topId !== customerId || nextOwner !== ownerId || !previousOwner
    || previousOwner === nextOwner || nextVersion !== version || topVersion !== version || !updatedAt) return null;
  return { customerId, version, ownerEmployeePublicId: nextOwner, previousOwnerEmployeePublicId: previousOwner, updatedAt };
}

export async function handleCustomerTransferCommand(
  request: Request,
  context: CustomerContext,
  dependencies: CustomerCommandDependencies,
) {
  const guard = initialGuard(dependencies);
  if (guard) return guard;
  const customerId = canonicalUuid((await context.params).customerId);
  const ids = commandIds(request, dependencies);
  if (!customerId) return json({ error: "invalid_request" }, 400);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await strictBody(request);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, ["ownerEmployeePublicId", "expectedVersion", "reason"])) {
    return json({ error: "invalid_request" }, 400);
  }
  const ownerId = canonicalUuid(body.value.ownerEmployeePublicId);
  const expectedVersion = positiveInteger(body.value.expectedVersion);
  const reason = text(body.value.reason, 500, true);
  if (!ownerId || !expectedVersion || expectedVersion >= Number.MAX_SAFE_INTEGER || !reason) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await invoke("transfer_current_customer_owner", {
    p_customer_public_id: customerId, p_new_owner_employee_public_id: ownerId,
    p_expected_version: expectedVersion, p_reason: reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const transfer = canonicalTransfer(result, customerId, ownerId, expectedVersion + 1);
  return transfer ? json({ outcome: "success", resource: "customer_transfer", transfer })
    : json({ error: "customer_command_unavailable" }, 503);
}

const contractStatuses = new Set(["draft", "active", "completed", "terminated"]);

function canonicalContract(result: Record<string, unknown>, customerId: string, input: {
  opportunityId: string | null;
  projectId: string | null;
  contractNumber: string;
  title: string;
  status: string;
  amount: string;
  currency: string;
  signedOn: string | null;
  startsOn: string;
  endsOn: string;
}) {
  if (result.resource !== "customer_contract") return null;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  if (!entity || !exactKeys(entity, [
    "id", "customerId", "opportunityId", "projectId", "contractNumber", "title", "status",
    "amount", "currency", "signedOn", "startsOn", "endsOn", "version", "createdAt", "updatedAt",
  ])) return null;
  const id = canonicalUuid(entity.id);
  const topId = canonicalUuid(result.id);
  const entityCustomerId = canonicalUuid(entity.customerId);
  const opportunityId = entity.opportunityId === null ? null : canonicalUuid(entity.opportunityId);
  const projectId = entity.projectId === null ? null : canonicalUuid(entity.projectId);
  const version = positiveInteger(entity.version);
  const topVersion = positiveInteger(result.version);
  const createdAt = timestamp(entity.createdAt);
  const updatedAt = timestamp(entity.updatedAt);
  if (!id || topId !== id || entityCustomerId !== customerId || opportunityId !== input.opportunityId
    || projectId !== input.projectId || entity.contractNumber !== input.contractNumber
    || entity.title !== input.title || entity.status !== input.status || entity.amount !== input.amount
    || entity.currency !== input.currency || entity.signedOn !== input.signedOn
    || entity.startsOn !== input.startsOn || entity.endsOn !== input.endsOn
    || version !== 1 || topVersion !== 1 || !createdAt || !updatedAt) return null;
  return { id, customerId, opportunityId, projectId, contractNumber: input.contractNumber,
    title: input.title, status: input.status, amount: input.amount, currency: input.currency,
    signedOn: input.signedOn, startsOn: input.startsOn, endsOn: input.endsOn,
    version, createdAt, updatedAt };
}

export async function handleCustomerContractCreateCommand(
  request: Request,
  context: CustomerContext,
  dependencies: CustomerCommandDependencies,
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
    "opportunityId", "projectId", "contractNumber", "title", "status", "amount", "currency",
    "signedOn", "startsOn", "endsOn", "version", "reason",
  ])) return json({ error: "invalid_request" }, 400);
  const opportunityId = body.value.opportunityId === null ? null : canonicalUuid(body.value.opportunityId);
  const projectId = body.value.projectId === null ? null : canonicalUuid(body.value.projectId);
  const contractNumber = text(body.value.contractNumber, 80, true);
  const title = text(body.value.title, 160, true);
  const status = typeof body.value.status === "string" && contractStatuses.has(body.value.status)
    ? body.value.status : null;
  const amount = money(body.value.amount);
  const currency = typeof body.value.currency === "string" && /^[A-Z]{3}$/.test(body.value.currency)
    ? body.value.currency : null;
  const signedOn = date(body.value.signedOn, true);
  const startsOn = date(body.value.startsOn);
  const endsOn = date(body.value.endsOn);
  const reason = text(body.value.reason, 500, true);
  if ((body.value.opportunityId !== null && !opportunityId) || (body.value.projectId !== null && !projectId)
    || (!opportunityId && !projectId) || !contractNumber || !title || !status || !amount || !currency
    || signedOn === undefined || !startsOn || !endsOn || endsOn < startsOn
    || body.value.version !== 0 || !reason) return json({ error: "invalid_request" }, 400);
  const input = { opportunityId, projectId, contractNumber, title, status, amount, currency, signedOn, startsOn, endsOn };
  const result = await invoke("create_current_customer_contract", {
    p_customer_public_id: customerId, p_opportunity_public_id: opportunityId,
    p_project_public_id: projectId, p_contract_number: contractNumber, p_title: title,
    p_status: status, p_amount: amount, p_currency: currency, p_signed_on: signedOn,
    p_starts_on: startsOn, p_ends_on: endsOn, p_version: 0, p_reason: reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const contract = canonicalContract(result, customerId, input);
  return contract ? json({ outcome: "success", resource: "customer_contract", contract }, 201)
    : json({ error: "customer_command_unavailable" }, 503);
}

const sourceSystems = new Set(["feishu", "import", "external_crm", "n8n", "other"]);

function canonicalSourceLink(result: Record<string, unknown>, customerId: string, input: {
  contactId: string | null;
  opportunityId: string | null;
  projectId: string | null;
  sourceSystem: string;
  externalRecordId: string;
  sourceUrl: string | null;
}) {
  if (result.resource !== "crm_source_link") return null;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  if (!entity || !exactKeys(entity, [
    "id", "customerId", "contactId", "opportunityId", "projectId", "sourceSystem",
    "externalRecordId", "sourceUrl", "createdAt",
  ])) return null;
  const id = canonicalUuid(entity.id);
  const topId = canonicalUuid(result.id);
  const resultCustomerId = canonicalUuid(entity.customerId);
  const contactId = entity.contactId === null ? null : canonicalUuid(entity.contactId);
  const opportunityId = entity.opportunityId === null ? null : canonicalUuid(entity.opportunityId);
  const projectId = entity.projectId === null ? null : canonicalUuid(entity.projectId);
  const createdAt = timestamp(entity.createdAt);
  if (!id || topId !== id || resultCustomerId !== customerId || contactId !== input.contactId
    || opportunityId !== input.opportunityId || projectId !== input.projectId
    || entity.sourceSystem !== input.sourceSystem || entity.externalRecordId !== input.externalRecordId
    || entity.sourceUrl !== input.sourceUrl || !createdAt || result.version !== 1) return null;
  return { id, customerId, contactId, opportunityId, projectId, sourceSystem: input.sourceSystem,
    externalRecordId: input.externalRecordId, sourceUrl: input.sourceUrl, createdAt };
}

export async function handleCustomerSourceLinkCreateCommand(
  request: Request,
  context: CustomerContext,
  dependencies: CustomerCommandDependencies,
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
    "contactId", "opportunityId", "projectId", "sourceSystem", "externalRecordId", "sourceUrl",
    "version", "reason",
  ])) return json({ error: "invalid_request" }, 400);
  const contactId = body.value.contactId === null ? null : canonicalUuid(body.value.contactId);
  const opportunityId = body.value.opportunityId === null ? null : canonicalUuid(body.value.opportunityId);
  const projectId = body.value.projectId === null ? null : canonicalUuid(body.value.projectId);
  const sourceSystem = typeof body.value.sourceSystem === "string" && sourceSystems.has(body.value.sourceSystem)
    ? body.value.sourceSystem : null;
  const externalRecordId = text(body.value.externalRecordId, 255, true);
  const sourceUrl = nullableText(body.value.sourceUrl, 2048);
  const reason = text(body.value.reason, 500, true);
  const supplied = [contactId, opportunityId, projectId].filter(Boolean).length;
  if ((body.value.contactId !== null && !contactId) || (body.value.opportunityId !== null && !opportunityId)
    || (body.value.projectId !== null && !projectId) || supplied !== 1 || !sourceSystem
    || !externalRecordId || sourceUrl === undefined || typeof sourceUrl === "string" && !safeSourceUrl(sourceUrl)
    || body.value.version !== 0 || !reason) return json({ error: "invalid_request" }, 400);
  const input = { contactId, opportunityId, projectId, sourceSystem, externalRecordId, sourceUrl };
  const result = await invoke("create_current_crm_source_link", {
    p_customer_public_id: customerId, p_contact_public_id: contactId,
    p_opportunity_public_id: opportunityId, p_project_public_id: projectId,
    p_source_system: sourceSystem, p_external_record_id: externalRecordId,
    p_source_url: sourceUrl, p_version: 0, p_reason: reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const sourceLink = canonicalSourceLink(result, customerId, input);
  return sourceLink ? json({ outcome: "success", resource: "crm_source_link", sourceLink }, 201)
    : json({ error: "customer_command_unavailable" }, 503);
}

function canonicalLifecycle(result: Record<string, unknown>, customerId: string, archived: boolean, version: number) {
  if (result.resource !== "customer_lifecycle") return null;
  const entity = result.entity && typeof result.entity === "object" && !Array.isArray(result.entity)
    ? result.entity as Record<string, unknown> : null;
  if (!entity || !exactKeys(entity, ["id", "version", "archived", "archivedAt"])) return null;
  const id = canonicalUuid(entity.id);
  const topId = canonicalUuid(result.id);
  const nextVersion = positiveInteger(entity.version);
  const topVersion = positiveInteger(result.version);
  const archivedAt = timestamp(entity.archivedAt, true);
  if (id !== customerId || topId !== customerId || nextVersion !== version || topVersion !== version
    || entity.archived !== archived || archivedAt === undefined || archived !== (archivedAt !== null)) return null;
  return { customerId, version, archived, archivedAt };
}

async function lifecycleCommand(
  request: Request,
  context: CustomerContext,
  dependencies: CustomerCommandDependencies,
  archived: boolean,
) {
  const guard = initialGuard(dependencies);
  if (guard) return guard;
  const customerId = canonicalUuid((await context.params).customerId);
  const ids = commandIds(request, dependencies);
  if (!customerId) return json({ error: "invalid_request" }, 400);
  if (!ids) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await strictBody(request);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, ["expectedVersion", "reason"])) return json({ error: "invalid_request" }, 400);
  const expectedVersion = positiveInteger(body.value.expectedVersion);
  const reason = text(body.value.reason, 500, true);
  if (!expectedVersion || expectedVersion >= Number.MAX_SAFE_INTEGER || !reason) {
    return json({ error: "invalid_request" }, 400);
  }
  const result = await invoke(archived ? "archive_current_customer" : "restore_current_customer", {
    p_customer_public_id: customerId, p_expected_version: expectedVersion, p_reason: reason, ...ids,
  }, dependencies);
  if (result instanceof Response) return result;
  const lifecycle = canonicalLifecycle(result, customerId, archived, expectedVersion + 1);
  return lifecycle ? json({ outcome: "success", resource: "customer_lifecycle", lifecycle })
    : json({ error: "customer_command_unavailable" }, 503);
}

export function handleCustomerArchiveCommand(
  request: Request,
  context: CustomerContext,
  dependencies: CustomerCommandDependencies,
) {
  return lifecycleCommand(request, context, dependencies, true);
}

export function handleCustomerRestoreCommand(
  request: Request,
  context: CustomerContext,
  dependencies: CustomerCommandDependencies,
) {
  return lifecycleCommand(request, context, dependencies, false);
}

export async function defaultCustomerCommandDependencies(): Promise<CustomerCommandDependencies> {
  const session = await getWorkspaceSession();
  const client = await getSupabaseServerClient();
  return { session, async rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    return { data, error };
  } };
}
