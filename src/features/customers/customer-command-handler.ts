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
]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  if (["stale_version", "conflict", "scope_conflict"].includes(error)) return 409;
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

export async function defaultCustomerCommandDependencies(): Promise<CustomerCommandDependencies> {
  const session = await getWorkspaceSession();
  const client = await getSupabaseServerClient();
  return { session, async rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    return { data, error };
  } };
}
