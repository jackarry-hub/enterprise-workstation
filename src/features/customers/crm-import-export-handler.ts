import { createHash, randomUUID } from "node:crypto";

import { canonicalUuid } from "@/app/api/workstation/tasks/handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
type ExchangeSession = {
  tenantId: string;
  member: { status: string };
  permissionCodes: readonly string[];
};

export type CrmExchangeDependencies = {
  session: ExchangeSession | null;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  createRequestId?: () => string;
};

type ImportContact = {
  name: string;
  title: string;
  phone: string | null;
  email: string | null;
  visibility: "assigned" | "managers";
  isPrimary: boolean;
};

type ImportRow = {
  name: string;
  registrationCode: string | null;
  ownerEmployeePublicId: string;
  industry: string;
  source: "consulting" | "referral" | "event" | "outbound" | "other";
  region: string;
  contact: ImportContact | null;
  fingerprint: string;
};

type ImportRejection = { index: number; errors: string[] };
type ImportValidation = {
  accepted: Array<ImportRow & { index: number }>;
  rejected: ImportRejection[];
};

const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_IMPORT_ROWS = 200;
const MAX_IMPORT_BATCH_ROWS = 20;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCES = new Set<ImportRow["source"]>(["consulting", "referral", "event", "outbound", "other"]);
const VISIBILITIES = new Set<ImportContact["visibility"]>(["assigned", "managers"]);
const PUBLIC_FAILURES = new Set([
  "conflict", "not_found", "scope_conflict", "invalid_request", "command_failed", "export_too_large",
]);

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
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

function allowed(session: ExchangeSession | null, permission: "customer.import" | "customer.export") {
  return session?.member.status === "active" && session.permissionCodes.includes(permission);
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeCrmName(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function digestPart(value: string | null) {
  return value === null ? "-1:" : `${new TextEncoder().encode(value).byteLength}:${value}`;
}

export function computeCrmImportRowDigest(row: Omit<ImportRow, "fingerprint">) {
  const contact = row.contact;
  const canonical = [
    normalizeCrmName(row.name),
    row.registrationCode,
    row.ownerEmployeePublicId.toLowerCase(),
    row.industry.trim(),
    row.source,
    row.region.trim(),
    contact?.name.trim() ?? null,
    contact?.title.trim() ?? null,
    contact?.phone?.trim() ?? null,
    contact?.email?.trim().toLowerCase() ?? null,
    contact?.visibility ?? null,
    contact ? String(contact.isPrimary) : null,
  ].map(digestPart).join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function derivedUuid(base: string, rowFingerprint: string) {
  const hex = createHash("sha256").update(`${base}:${rowFingerprint}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function parseContact(value: unknown, errors: string[]) {
  if (value === null || value === undefined) return null;
  const contact = record(value);
  if (!contact || !exactKeys(contact, ["name", "title", "phone", "email", "visibility", "isPrimary"])) {
    errors.push("invalid_contact_shape");
    return null;
  }
  const name = text(contact.name, 120, true);
  const title = text(contact.title, 120);
  const phone = nullableText(contact.phone, 80);
  const email = nullableText(contact.email, 320, 3);
  const visibility = typeof contact.visibility === "string" && VISIBILITIES.has(contact.visibility as ImportContact["visibility"])
    ? contact.visibility as ImportContact["visibility"] : null;
  if (!name) errors.push("invalid_contact_name");
  if (title === null) errors.push("invalid_contact_title");
  if (phone === undefined) errors.push("invalid_contact_phone");
  if (email === undefined || typeof email === "string" && !EMAIL_PATTERN.test(email)) errors.push("invalid_contact_email");
  if (!phone && !email) errors.push("contact_channel_required");
  if (!visibility) errors.push("invalid_contact_visibility");
  if (typeof contact.isPrimary !== "boolean") errors.push("invalid_contact_primary_flag");
  return errors.length === 0 ? {
    name: name!, title: title!, phone: phone!, email: email!, visibility: visibility!,
    isPrimary: contact.isPrimary as boolean,
  } : null;
}

export function validateCrmImport(rows: unknown, tenantId: string): ImportValidation {
  void tenantId;
  if (!Array.isArray(rows)) return { accepted: [], rejected: [{ index: -1, errors: ["rows_required"] }] };
  if (rows.length === 0 || rows.length > MAX_IMPORT_ROWS) {
    return { accepted: [], rejected: [{ index: -1, errors: ["invalid_row_count"] }] };
  }
  const accepted: ImportValidation["accepted"] = [];
  const rejected: ImportRejection[] = [];
  const names = new Set<string>();
  const registrations = new Set<string>();
  rows.forEach((value, index) => {
    const errors: string[] = [];
    const row = record(value);
    if (!row) {
      rejected.push({ index, errors: ["invalid_row"] });
      return;
    }
    if (["tenantId", "organizationId", "actorId", "memberId"].some((key) => key in row)) {
      errors.push("untrusted_scope_field");
    }
    const allowedKeys = ["name", "registrationCode", "ownerEmployeePublicId", "industry", "source", "region", "contact"];
    if (!Object.keys(row).every((key) => allowedKeys.includes(key))) errors.push("unknown_field");
    const parsedName = text(row.name, 160, true);
    const name = parsedName ? normalizeCrmName(parsedName) : null;
    const registrationCode = nullableText(row.registrationCode, 80);
    const ownerEmployeePublicId = canonicalUuid(row.ownerEmployeePublicId);
    const industry = text(row.industry, 80, true);
    const source = typeof row.source === "string" && SOURCES.has(row.source as ImportRow["source"])
      ? row.source as ImportRow["source"] : null;
    const region = text(row.region, 120);
    if (!name) errors.push("invalid_name");
    if (registrationCode === undefined) errors.push("invalid_registration_code");
    if (!ownerEmployeePublicId) errors.push("invalid_owner");
    if (!industry) errors.push("invalid_industry");
    if (!source) errors.push("invalid_source");
    if (region === null) errors.push("invalid_region");
    const contactErrors: string[] = [];
    const contact = parseContact(row.contact, contactErrors);
    errors.push(...contactErrors);
    const normalizedName = name?.toLocaleLowerCase("zh-CN");
    const normalizedRegistration = typeof registrationCode === "string" ? registrationCode.toUpperCase() : null;
    if (normalizedName && names.has(normalizedName)) errors.push("duplicate_name_in_batch");
    if (normalizedRegistration && registrations.has(normalizedRegistration)) errors.push("duplicate_registration_in_batch");
    if (errors.length > 0) {
      rejected.push({ index, errors: [...new Set(errors)] });
      return;
    }
    names.add(normalizedName!);
    if (normalizedRegistration) registrations.add(normalizedRegistration);
    const canonical = {
      name: name!, registrationCode: registrationCode!, ownerEmployeePublicId: ownerEmployeePublicId!,
      industry: industry!, source: source!, region: region!, contact,
    };
    accepted.push({ ...canonical, index, fingerprint: computeCrmImportRowDigest(canonical) });
  });
  return { accepted, rejected };
}

async function readJson(request: Request, maximum = 32 * 1024) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { ok: false as const, response: json({ error: "unsupported_media_type" }, 415) };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    return { ok: false as const, response: json({ error: "payload_too_large" }, 413) };
  }
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maximum) {
      return { ok: false as const, response: json({ error: "payload_too_large" }, 413) };
    }
    const value = JSON.parse(raw);
    const body = record(value);
    return body ? { ok: true as const, value: body }
      : { ok: false as const, response: json({ error: "invalid_request" }, 400) };
  } catch {
    return { ok: false as const, response: json({ error: "invalid_json" }, 400) };
  }
}

function commandKey(request: Request) {
  return canonicalUuid(request.headers.get("Idempotency-Key"));
}

function canonicalImportResult(value: unknown, expected: ImportRow) {
  const result = record(value);
  const entity = record(result?.entity);
  if (!result || !entity || !exactKeys(result, ["outcome", "resource", "id", "version", "entity"])
    || !exactKeys(entity, ["id", "version", "contactId", "name", "registrationCode"])
    || result.outcome !== "success" || result.resource !== "customer_import") return null;
  const id = canonicalUuid(entity.id);
  const topId = canonicalUuid(result.id);
  const contactId = entity.contactId === null ? null : canonicalUuid(entity.contactId);
  if (!id || topId !== id || result.version !== 1 || entity.version !== 1
    || entity.name !== expected.name || entity.registrationCode !== expected.registrationCode
    || (entity.contactId !== null && !contactId) || Boolean(contactId) !== Boolean(expected.contact)) return null;
  return { customerId: id, contactId };
}

function canonicalImportJob(value: unknown, expected: {
  id?: string;
  status: "running" | "completed" | "completed_with_errors";
  totalRows: number;
  validRows?: number;
  validationRejectedRows?: number;
}) {
  const result = record(value);
  const entity = record(result?.entity);
  const running = expected.status === "running";
  const keys = running
    ? ["id", "version", "status", "totalRows", "validRows", "validationRejectedRows"]
    : ["id", "version", "status", "totalRows", "acceptedRows", "rejectedRows"];
  if (!result || !entity || !exactKeys(result, ["outcome", "resource", "id", "version", "entity"])
    || !exactKeys(entity, keys) || result.outcome !== "success" || result.resource !== "crm_import_job") return null;
  const id = canonicalUuid(entity.id);
  const topId = canonicalUuid(result.id);
  if (!id || topId !== id || expected.id && id !== expected.id || result.version !== 1 || entity.version !== 1
    || entity.status !== expected.status || entity.totalRows !== expected.totalRows) return null;
  if (running && (!Number.isSafeInteger(entity.validRows) || !Number.isSafeInteger(entity.validationRejectedRows)
    || entity.validRows !== expected.validRows
    || entity.validationRejectedRows !== expected.validationRejectedRows
    || Number(entity.validRows) + Number(entity.validationRejectedRows) !== expected.totalRows)) return null;
  if (!running && (!Number.isSafeInteger(entity.acceptedRows) || !Number.isSafeInteger(entity.rejectedRows))) return null;
  if (!running && (Number(entity.acceptedRows) < 0 || Number(entity.rejectedRows) < 0
    || Number(entity.acceptedRows) + Number(entity.rejectedRows) !== expected.totalRows)) return null;
  return { id, acceptedRows: running ? null : Number(entity.acceptedRows),
    rejectedRows: running ? null : Number(entity.rejectedRows) };
}

export async function handleCrmImport(request: Request, dependencies: CrmExchangeDependencies) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (!allowed(dependencies.session, "customer.import")) return json({ error: "forbidden" }, 403);
  const baseKey = commandKey(request);
  if (!baseKey) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await readJson(request, MAX_IMPORT_BYTES);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, ["rows", "reason", "cursor"])) return json({ error: "invalid_request" }, 400);
  const reason = text(body.value.reason, 500, true);
  const cursor = body.value.cursor;
  if (!reason || !Number.isSafeInteger(cursor) || Number(cursor) < 0) {
    return json({ error: "invalid_request" }, 400);
  }
  const validated = validateCrmImport(body.value.rows, dependencies.session.tenantId);
  const totalRows = Array.isArray(body.value.rows) ? body.value.rows.length : 0;
  if (Number(cursor) > validated.accepted.length) return json({ error: "invalid_request" }, 400);
  const payloadDigest = fingerprint({ tenantId: dependencies.session.tenantId,
    accepted: validated.accepted.map(({ index, fingerprint: rowDigest }) => ({ index, rowDigest })),
    rejected: validated.rejected });
  let beginResult: RpcResult;
  try {
    beginResult = await dependencies.rpc("begin_current_crm_import", {
      p_payload_digest: payloadDigest, p_total_rows: totalRows,
      p_valid_rows: validated.accepted.length,
      p_accepted_manifest: validated.accepted.map(({ index, fingerprint: rowDigest }) => ({ index, rowDigest })),
      p_validation_rejections: validated.rejected,
      p_reason: reason, request_id: dependencies.createRequestId?.() ?? randomUUID(),
      idempotency_key: baseKey,
    });
  } catch {
    return json({ error: "crm_import_unavailable" }, 503);
  }
  if (beginResult.error) {
    if (beginResult.error.code === "42501") return json({ error: "forbidden" }, 403);
    if (beginResult.error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
    return json({ error: "crm_import_unavailable" }, 503);
  }
  const beginFailure = record(beginResult.data);
  if (beginFailure?.outcome === "failure") return json({ error: "crm_import_unavailable" }, 503);
  const importJob = canonicalImportJob(beginResult.data, { status: "running", totalRows,
    validRows: validated.accepted.length, validationRejectedRows: validated.rejected.length });
  if (!importJob) return json({ error: "crm_import_unavailable" }, 503);
  const batch = validated.accepted.slice(Number(cursor), Number(cursor) + MAX_IMPORT_BATCH_ROWS);
  const batchRejected: ImportRejection[] = Number(cursor) === 0 ? [...validated.rejected] : [];
  for (const row of batch) {
    const idempotencyKey = derivedUuid(baseKey, row.fingerprint);
    let rpcResult: RpcResult;
    try {
      rpcResult = await dependencies.rpc("import_current_customer_row", {
        p_import_job_public_id: importJob.id, p_row_index: row.index, p_row_digest: row.fingerprint,
        p_name: row.name, p_registration_code: row.registrationCode,
        p_owner_employee_public_id: row.ownerEmployeePublicId,
        p_industry: row.industry, p_source: row.source, p_region: row.region,
        p_contact_name: row.contact?.name ?? null, p_contact_title: row.contact?.title ?? null,
        p_contact_phone: row.contact?.phone ?? null, p_contact_email: row.contact?.email ?? null,
        p_contact_visibility: row.contact?.visibility ?? null,
        p_contact_is_primary: row.contact?.isPrimary ?? null,
        p_version: 0, p_reason: reason,
        request_id: dependencies.createRequestId?.() ?? randomUUID(),
        idempotency_key: idempotencyKey,
      });
    } catch {
      return json({ error: "crm_import_unavailable" }, 503);
    }
    if (rpcResult.error) {
      if (rpcResult.error.code === "42501") return json({ error: "forbidden" }, 403);
      if (rpcResult.error.code?.startsWith("22")) return json({ error: "crm_import_unavailable" }, 503);
      return json({ error: "crm_import_unavailable" }, 503);
    }
    const failure = record(rpcResult.data);
    if (failure?.outcome === "failure" && exactKeys(failure, ["outcome", "error"])
      && typeof failure.error === "string" && PUBLIC_FAILURES.has(failure.error)) {
      batchRejected.push({ index: row.index, errors: [failure.error] });
      continue;
    }
    if (!canonicalImportResult(rpcResult.data, row)) return json({ error: "crm_import_unavailable" }, 503);
  }
  const nextCursor = Number(cursor) + batch.length;
  if (nextCursor < validated.accepted.length) {
    return json({ outcome: "processing", resource: "crm_import", jobId: importJob.id,
      nextCursor, processedRows: nextCursor, validRows: validated.accepted.length,
      validationRejectedRows: validated.rejected.length, totalRows, rejected: batchRejected }, 202);
  }
  let finalizeResult: RpcResult;
  try {
    finalizeResult = await dependencies.rpc("finalize_current_crm_import", {
      p_import_job_public_id: importJob.id, p_reason: reason,
      request_id: dependencies.createRequestId?.() ?? randomUUID(),
      idempotency_key: derivedUuid(baseKey, "finalize"),
    });
  } catch {
    return json({ error: "crm_import_unavailable" }, 503);
  }
  if (finalizeResult.error) {
    if (finalizeResult.error.code === "42501") return json({ error: "forbidden" }, 403);
    return json({ error: "crm_import_unavailable" }, 503);
  }
  const finalEntity = record(record(finalizeResult.data)?.entity);
  const finalStatus = finalEntity?.status === "completed_with_errors" ? "completed_with_errors" : "completed";
  const finalized = canonicalImportJob(finalizeResult.data, { id: importJob.id, status: finalStatus, totalRows });
  if (!finalized || finalized.acceptedRows === null || finalized.rejectedRows === null) {
    return json({ error: "crm_import_unavailable" }, 503);
  }
  const outcome = finalized.rejectedRows > 0
    ? finalized.acceptedRows > 0 ? "partial" : "failure" : "success";
  return json({ outcome, resource: "crm_import", jobId: importJob.id,
    acceptedRows: finalized.acceptedRows, rejectedRows: finalized.rejectedRows,
    totalRows, rejected: batchRejected }, finalized.rejectedRows > 0 ? 207 : 200);
}

function canonicalExportRow(value: unknown, includeContactPii: boolean) {
  const row = record(value);
  const baseKeys = ["id", "name", "registrationCode", "industry", "source", "region", "status", "ownerEmployeePublicId"];
  if (!row || !exactKeys(row, includeContactPii ? [...baseKeys, "primaryContact"] : baseKeys)) return null;
  const id = canonicalUuid(row.id);
  const ownerEmployeePublicId = canonicalUuid(row.ownerEmployeePublicId);
  const name = text(row.name, 160, true);
  const registrationCode = nullableText(row.registrationCode, 80);
  const industry = text(row.industry, 80, true);
  const region = text(row.region, 120);
  if (!id || !ownerEmployeePublicId || !name || registrationCode === undefined || !industry || region === null
    || typeof row.source !== "string" || !SOURCES.has(row.source as ImportRow["source"])
    || typeof row.status !== "string" || !["lead", "following", "proposal", "negotiating", "won", "lost"].includes(row.status)) return null;
  if (includeContactPii && row.primaryContact !== null) {
    const contact = record(row.primaryContact);
    if (!contact || !exactKeys(contact, ["id", "name", "title", "phone", "email"]) || !canonicalUuid(contact.id)
      || !text(contact.name, 120, true) || text(contact.title, 120) === null
      || nullableText(contact.phone, 80) === undefined || nullableText(contact.email, 320, 3) === undefined) return null;
  }
  return row;
}

function canonicalExport(value: unknown, expectedCustomerId: string | null, includeContactPii: boolean, now: number) {
  const result = record(value);
  const entity = record(result?.entity);
  if (!result || !entity || !exactKeys(result, ["outcome", "resource", "id", "version", "entity"])
    || !exactKeys(entity, ["id", "version", "watermark", "scope", "customerId", "includeContactPii", "rowCount", "exportedAt", "expiresAt", "sha256", "downloadUrl"])
    || result.outcome !== "success" || result.resource !== "crm_export") return null;
  const id = canonicalUuid(entity.id);
  const topId = canonicalUuid(result.id);
  const watermark = canonicalUuid(entity.watermark);
  const customerId = entity.customerId === null ? null : canonicalUuid(entity.customerId);
  if (!id || topId !== id || !watermark || result.version !== 1 || entity.version !== 1
    || customerId !== expectedCustomerId || entity.scope !== (expectedCustomerId ? "customer" : "all")
    || entity.includeContactPii !== includeContactPii || !Number.isSafeInteger(entity.rowCount)
    || Number(entity.rowCount) < 0 || Number(entity.rowCount) > 5000
    || typeof entity.exportedAt !== "string" || !Number.isFinite(Date.parse(entity.exportedAt))
    || typeof entity.expiresAt !== "string" || !Number.isFinite(Date.parse(entity.expiresAt))
    || Date.parse(entity.expiresAt) <= Date.parse(entity.exportedAt) || Date.parse(entity.expiresAt) <= now
    || typeof entity.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entity.sha256)
    || entity.downloadUrl !== `/api/workstation/customers/export/${id}`) return null;
  return { exportId: id, watermark, includeContactPii, exportedAt: entity.exportedAt,
    expiresAt: entity.expiresAt, rowCount: entity.rowCount, sha256: entity.sha256,
    downloadUrl: entity.downloadUrl };
}

export async function handleCrmExport(request: Request, dependencies: CrmExchangeDependencies) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (!allowed(dependencies.session, "customer.export")) return json({ error: "forbidden" }, 403);
  const idempotencyKey = commandKey(request);
  if (!idempotencyKey) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, ["customerId", "includeContactPii", "reason"])) {
    return json({ error: "invalid_request" }, 400);
  }
  const customerId = body.value.customerId === null ? null : canonicalUuid(body.value.customerId);
  const reason = text(body.value.reason, 500, true);
  if ((body.value.customerId !== null && !customerId) || typeof body.value.includeContactPii !== "boolean" || !reason) {
    return json({ error: "invalid_request" }, 400);
  }
  if (body.value.includeContactPii && !dependencies.session.permissionCodes.includes("customer.export_pii")) {
    return json({ error: "forbidden" }, 403);
  }
  let result: RpcResult;
  try {
    result = await dependencies.rpc("request_current_crm_export", {
      p_customer_public_id: customerId,
      p_include_contact_pii: body.value.includeContactPii,
      p_reason: reason,
      request_id: dependencies.createRequestId?.() ?? randomUUID(),
      idempotency_key: idempotencyKey,
    });
  } catch {
    return json({ error: "crm_export_unavailable" }, 503);
  }
  if (result.error) {
    if (result.error.code === "42501") return json({ error: "forbidden" }, 403);
    if (result.error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
    return json({ error: "crm_export_unavailable" }, 503);
  }
  const failure = record(result.data);
  if (failure?.outcome === "failure" && exactKeys(failure, ["outcome", "error"]) && typeof failure.error === "string") {
    const known = PUBLIC_FAILURES.has(failure.error);
    const error = known ? failure.error : "crm_export_unavailable";
    const status = error === "not_found" ? 404 : error === "invalid_request" ? 400
      : error === "export_too_large" ? 413 : error === "command_failed" || !known ? 503 : 409;
    return json({ error: error === "command_failed" ? "crm_export_unavailable" : error }, status);
  }
  const canonical = canonicalExport(result.data, customerId, body.value.includeContactPii, Date.now());
  if (!canonical) return json({ error: "crm_export_unavailable" }, 503);
  return json({ outcome: "success", resource: "crm_export", ...canonical }, 202, {
    "X-CRM-Export-Watermark": canonical.watermark,
  });
}

export async function handleCrmExportDownload(
  _request: Request,
  context: { params: Promise<{ exportId: string }> },
  dependencies: CrmExchangeDependencies,
) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (!allowed(dependencies.session, "customer.export")) return json({ error: "forbidden" }, 403);
  const exportId = canonicalUuid((await context.params).exportId);
  if (!exportId) return json({ error: "invalid_request" }, 400);
  let result: RpcResult;
  try {
    result = await dependencies.rpc("download_current_crm_export", {
      p_export_public_id: exportId,
      request_id: dependencies.createRequestId?.() ?? randomUUID(),
    });
  } catch {
    return json({ error: "crm_export_unavailable" }, 503);
  }
  if (result.error) {
    if (result.error.code === "42501") return json({ error: "forbidden" }, 403);
    return json({ error: "crm_export_unavailable" }, 503);
  }
  const payload = record(result.data);
  if (payload?.outcome === "failure" && exactKeys(payload, ["outcome", "error"])) {
    if (payload.error === "not_found") return json({ error: "not_found" }, 404);
    if (payload.error === "export_expired") return json({ error: "export_expired" }, 410);
    if (payload.error === "scope_revoked") return json({ error: "scope_revoked" }, 403);
    return json({ error: "crm_export_unavailable" }, 503);
  }
  if (!payload || !exactKeys(payload, ["id", "watermark", "includeContactPii", "rowCount", "sha256", "exportedAt", "rows"])) {
    return json({ error: "crm_export_unavailable" }, 503);
  }
  const id = canonicalUuid(payload.id);
  const watermark = canonicalUuid(payload.watermark);
  const includeContactPii = payload.includeContactPii;
  const rows = Array.isArray(payload.rows)
    ? payload.rows.map((row) => canonicalExportRow(row, includeContactPii === true)) : [];
  if (id !== exportId || !watermark || typeof includeContactPii !== "boolean"
    || !Number.isSafeInteger(payload.rowCount) || payload.rowCount !== rows.length || rows.some((row) => !row)
    || typeof payload.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(payload.sha256)
    || typeof payload.exportedAt !== "string" || !Number.isFinite(Date.parse(payload.exportedAt))) {
    return json({ error: "crm_export_unavailable" }, 503);
  }
  return json({ exportId, watermark, includeContactPii, sha256: payload.sha256,
    exportedAt: payload.exportedAt, rows }, 200, {
    "X-CRM-Export-Watermark": watermark,
    "X-CRM-Export-SHA256": payload.sha256,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="quantxy-crm-${exportId}.json"`,
  });
}

export async function defaultCrmExchangeDependencies(): Promise<CrmExchangeDependencies> {
  const session = await getWorkspaceSession();
  const client = await getSupabaseServerClient();
  return { session, async rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    return { data, error };
  } };
}
