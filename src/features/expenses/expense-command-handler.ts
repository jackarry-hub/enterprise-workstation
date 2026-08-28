import { randomUUID } from "node:crypto";

import { canonicalUuid, readStrictJson } from "@/app/api/workstation/tasks/handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };

export type ExpenseCommandDependencies = {
  session: { member: { status: string }; permissionCodes: readonly string[] } | null;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  createRequestId?: () => string;
};

const EXPENSE_TYPES = new Set(["travel", "meal", "transport", "office", "other"]);
const EXPENSE_STATUSES = new Set([
  "draft", "submitted", "approved", "rejected", "paid", "cancelled",
]);
const PUBLIC_FAILURES = new Set([
  "forbidden", "expense_not_found", "invalid_receipt", "invalid_state",
  "approval_unavailable", "conflict", "scope_conflict", "command_failed",
]);
const AMOUNT_PATTERN = /^(?:0\.(?:0[1-9]|[1-9][0-9]?)|[1-9][0-9]{0,11}(?:\.[0-9]{1,2})?)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CODE_PATTERN = /^EXP-[0-9A-F]{20}$/;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function boundedText(value: unknown, maximum: number, required = true) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return (required ? normalized.length > 0 : true) && normalized.length <= maximum
    ? normalized : null;
}

function canonicalDate(value: unknown) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  if (Number(value.slice(0, 4)) < 1) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value : null;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    match.slice(1).map((part) => part === undefined ? 0 : Number(part));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59
    && Number.isFinite(Date.parse(value)) ? value : null;
}

function receiptIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const ids = value.map(canonicalUuid);
  return ids.some((id) => !id) || new Set(ids).size !== ids.length ? null : ids as string[];
}

function canonicalAmount(value: unknown) {
  if (typeof value !== "string" || !AMOUNT_PATTERN.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function expectedVersion(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 2_147_483_647
    ? Number(value) : null;
}

function parseEditable(value: Record<string, unknown>) {
  const expenseType = typeof value.expenseType === "string" && EXPENSE_TYPES.has(value.expenseType)
    ? value.expenseType : null;
  const amount = canonicalAmount(value.amount);
  const expenseDate = canonicalDate(value.expenseDate);
  const description = boundedText(value.description, 500);
  const receipts = receiptIds(value.receiptFileIds);
  return expenseType && amount && expenseDate && description && receipts
    ? { expenseType, amount, expenseDate, description, receiptFileIds: receipts }
    : null;
}

async function strictBody(request: Request) {
  const parsed = await readStrictJson(request);
  if (!parsed.ok) {
    const status = parsed.error === "unsupported_media_type" ? 415
      : parsed.error === "payload_too_large" ? 413 : 400;
    return { ok: false, response: json({ error: parsed.error }, status) } as const;
  }
  const value = record(parsed.value);
  return value ? { ok: true, value } as const
    : { ok: false, response: json({ error: "invalid_request" }, 400) } as const;
}

function failureStatus(error: string) {
  if (error === "forbidden") return 403;
  if (error === "expense_not_found") return 404;
  if (error === "invalid_receipt") return 422;
  if (["invalid_state", "approval_unavailable", "conflict", "scope_conflict"].includes(error)) return 409;
  return 503;
}

type ExpenseExpectation = {
  statuses: readonly string[];
  projectId?: string | null;
  expenseType?: string;
  amount?: string;
  expenseDate?: string;
  description?: string;
  receiptFileIds?: readonly string[];
  paymentReference?: string;
};

function sameStrings(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function canonicalExpense(
  value: unknown,
  expectedId: string | null,
  expectedVersionValue: number,
  expectation: ExpenseExpectation,
) {
  const root = record(value);
  if (!root || !exactKeys(root, ["outcome", "resource", "id", "version", "entity"])
    || root.outcome !== "success" || root.resource !== "expense") return null;
  const entity = record(root.entity);
  const id = canonicalUuid(root.id);
  const version = root.version;
  if (!entity || !exactKeys(entity, [
    "id", "version", "expenseCode", "status", "projectId", "expenseType", "amount",
    "currency", "expenseDate", "description", "receiptFileIds", "approvalId",
    "ownerEmployeeId", "paidAt", "paymentReference", "updatedAt",
  ]) || !id || (expectedId !== null && id !== expectedId) || canonicalUuid(entity.id) !== id
    || version !== expectedVersionValue || entity.version !== version
    || typeof entity.expenseCode !== "string" || !CODE_PATTERN.test(entity.expenseCode)
    || entity.expenseCode !== `EXP-${id.replaceAll("-", "").slice(0, 20).toUpperCase()}`
    || typeof entity.status !== "string" || !EXPENSE_STATUSES.has(entity.status)
    || (entity.projectId !== null && !canonicalUuid(entity.projectId))
    || typeof entity.expenseType !== "string" || !EXPENSE_TYPES.has(entity.expenseType)
    || typeof entity.amount !== "string" || canonicalAmount(entity.amount) !== entity.amount
    || entity.currency !== "CNY" || !canonicalDate(entity.expenseDate)
    || !boundedText(entity.description, 500)
    || entity.description !== boundedText(entity.description, 500)
    || receiptIds(entity.receiptFileIds) === null
    || (entity.approvalId !== null && !canonicalUuid(entity.approvalId))
    || (entity.ownerEmployeeId !== null && !canonicalUuid(entity.ownerEmployeeId))
    || !timestamp(entity.updatedAt)) return null;
  const status = entity.status;
  const projectId = entity.projectId === null ? null : String(entity.projectId).toLowerCase();
  const canonicalReceipts = receiptIds(entity.receiptFileIds)!;
  const paidAt = entity.paidAt === null ? null : timestamp(entity.paidAt);
  const updatedAt = timestamp(entity.updatedAt);
  const paymentReference = entity.paymentReference === null
    ? null : boundedText(entity.paymentReference, 120);
  if (!expectation.statuses.includes(String(status))
    || (expectation.projectId !== undefined && projectId !== expectation.projectId)
    || (expectation.expenseType !== undefined && entity.expenseType !== expectation.expenseType)
    || (expectation.amount !== undefined && entity.amount !== expectation.amount)
    || (expectation.expenseDate !== undefined && entity.expenseDate !== expectation.expenseDate)
    || (expectation.description !== undefined && entity.description !== expectation.description)
    || (expectation.receiptFileIds !== undefined
      && !sameStrings(canonicalReceipts, expectation.receiptFileIds))
    || (expectation.paymentReference !== undefined
      && paymentReference !== expectation.paymentReference)
    || (status === "submitted" && (!entity.approvalId || !entity.ownerEmployeeId))
    || (status === "paid" && (!entity.approvalId || !paidAt || !paymentReference
      || !updatedAt || Date.parse(paidAt) !== Date.parse(updatedAt)))
    || (status !== "paid" && (entity.paidAt !== null || entity.paymentReference !== null))
    || (["draft", "approved", "rejected", "paid", "cancelled"].includes(String(status))
      && entity.ownerEmployeeId !== null)
    || (status === "draft" && entity.approvalId !== null)
    || (["approved", "rejected", "paid"].includes(String(status)) && entity.approvalId === null)) return null;
  return {
    id,
    version: Number(version),
    expenseCode: String(entity.expenseCode),
    status,
    projectId,
    expenseType: String(entity.expenseType),
    amount: String(entity.amount),
    currency: "CNY" as const,
    expenseDate: String(entity.expenseDate),
    description: String(entity.description),
    receiptFileIds: canonicalReceipts,
    approvalId: entity.approvalId === null ? null : String(entity.approvalId).toLowerCase(),
    ownerEmployeeId: entity.ownerEmployeeId === null ? null : String(entity.ownerEmployeeId).toLowerCase(),
    paidAt,
    paymentReference,
    updatedAt: updatedAt!,
  };
}

async function invoke(
  dependencies: ExpenseCommandDependencies,
  name: string,
  args: Record<string, unknown>,
  expectedId: string | null,
  expectedResultVersion: number,
  expectation: ExpenseExpectation,
  successStatus = 200,
) {
  let rpcResult: RpcResult;
  try { rpcResult = await dependencies.rpc(name, args); }
  catch { return json({ error: "expense_command_unavailable" }, 503); }
  if (rpcResult.error) {
    return rpcResult.error.code === "42501" ? json({ error: "forbidden" }, 403)
      : json({ error: "expense_command_unavailable" }, 503);
  }
  const failure = record(rpcResult.data);
  if (failure?.outcome === "failure" && exactKeys(failure, ["outcome", "error"])
    && typeof failure.error === "string" && PUBLIC_FAILURES.has(failure.error)) {
    return json({ error: failure.error }, failureStatus(failure.error));
  }
  const expense = canonicalExpense(rpcResult.data, expectedId, expectedResultVersion, expectation);
  return expense ? json({ outcome: "success", resource: "expense", expense }, successStatus)
    : json({ error: "expense_command_unavailable" }, 503);
}

function authorize(dependencies: ExpenseCommandDependencies, permission: string) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (dependencies.session.member.status !== "active"
    || !dependencies.session.permissionCodes.includes(permission)) {
    return json({ error: "forbidden" }, 403);
  }
  return null;
}

function commandIds(request: Request, dependencies: ExpenseCommandDependencies) {
  const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
  const requestId = canonicalUuid(dependencies.createRequestId?.() ?? randomUUID());
  return idempotencyKey && requestId && idempotencyKey !== requestId
    ? { idempotencyKey, requestId } : null;
}

export async function handleExpenseCollection(request: Request, dependencies: ExpenseCommandDependencies) {
  const denial = authorize(dependencies, "expense.submit");
  if (denial) return denial;
  const parsed = await strictBody(request);
  if (!parsed.ok) return parsed.response;
  const ids = commandIds(request, dependencies);
  if (!ids) return json({ error: "invalid_request" }, 400);
  if (request.method === "POST") {
    if (!exactKeys(parsed.value, [
      "projectId", "expenseType", "amount", "expenseDate", "description", "receiptFileIds",
    ])) return json({ error: "invalid_request" }, 400);
    const editable = parseEditable(parsed.value);
    const projectId = parsed.value.projectId === null ? null : canonicalUuid(parsed.value.projectId);
    if (!editable || (parsed.value.projectId !== null && !projectId)
      || (editable.receiptFileIds.length > 0 && projectId === null)) {
      return json({ error: "invalid_request" }, 400);
    }
    return invoke(dependencies, "create_current_expense", {
      project_public_id: projectId,
      expense_type: editable.expenseType,
      amount: editable.amount,
      expense_date: editable.expenseDate,
      description: editable.description,
      receipt_file_ids: editable.receiptFileIds,
      idempotency_key: ids.idempotencyKey,
      request_id: ids.requestId,
    }, null, 1, {
      statuses: ["draft"], projectId, expenseType: editable.expenseType, amount: editable.amount,
      expenseDate: editable.expenseDate, description: editable.description,
      receiptFileIds: editable.receiptFileIds,
    }, 201);
  }
  if (request.method === "PATCH") {
    if (!exactKeys(parsed.value, [
      "expenseId", "expectedVersion", "expenseType", "amount", "expenseDate",
      "description", "receiptFileIds",
    ])) return json({ error: "invalid_request" }, 400);
    const expenseId = canonicalUuid(parsed.value.expenseId);
    const version = expectedVersion(parsed.value.expectedVersion);
    const editable = parseEditable(parsed.value);
    if (!expenseId || !version || !editable) return json({ error: "invalid_request" }, 400);
    return invoke(dependencies, "update_current_expense", {
      expense_public_id: expenseId,
      expected_version: version,
      expense_type: editable.expenseType,
      amount: editable.amount,
      expense_date: editable.expenseDate,
      description: editable.description,
      receipt_file_ids: editable.receiptFileIds,
      idempotency_key: ids.idempotencyKey,
      request_id: ids.requestId,
    }, expenseId, version + 1, {
      statuses: ["draft", "rejected"], expenseType: editable.expenseType, amount: editable.amount,
      expenseDate: editable.expenseDate, description: editable.description,
      receiptFileIds: editable.receiptFileIds,
    });
  }
  return json({ error: "method_not_allowed" }, 405);
}

async function lifecycleInput(
  request: Request,
  expenseIdInput: string,
  dependencies: ExpenseCommandDependencies,
  expectedKeys: readonly string[],
  permission = "expense.submit",
) {
  const denial = authorize(dependencies, permission);
  if (denial) return { ok: false, response: denial } as const;
  const expenseId = canonicalUuid(expenseIdInput);
  const parsed = await strictBody(request);
  if (!parsed.ok) return parsed;
  const ids = commandIds(request, dependencies);
  const version = expectedVersion(parsed.value.expectedVersion);
  if (!expenseId || !ids || !version || !exactKeys(parsed.value, expectedKeys)) {
    return { ok: false, response: json({ error: "invalid_request" }, 400) } as const;
  }
  return { ok: true, expenseId, value: parsed.value, version, ids } as const;
}

export async function handleExpenseSubmission(
  request: Request, expenseIdInput: string, dependencies: ExpenseCommandDependencies,
) {
  const parsed = await lifecycleInput(request, expenseIdInput, dependencies, ["expectedVersion"]);
  if (!parsed.ok) return parsed.response;
  return invoke(dependencies, "submit_current_expense", {
    expense_public_id: parsed.expenseId,
    expected_version: parsed.version,
    idempotency_key: parsed.ids.idempotencyKey,
    request_id: parsed.ids.requestId,
  }, parsed.expenseId, parsed.version + 1, { statuses: ["submitted"] });
}

export async function handleExpensePayment(
  request: Request, expenseIdInput: string, dependencies: ExpenseCommandDependencies,
) {
  const parsed = await lifecycleInput(
    request, expenseIdInput, dependencies, ["expectedVersion", "paymentReference"], "expense.manage",
  );
  if (!parsed.ok) return parsed.response;
  const paymentReference = boundedText(parsed.value.paymentReference, 120);
  if (!paymentReference) return json({ error: "invalid_request" }, 400);
  return invoke(dependencies, "mark_current_expense_paid", {
    expense_public_id: parsed.expenseId,
    expected_version: parsed.version,
    payment_reference: paymentReference,
    idempotency_key: parsed.ids.idempotencyKey,
    request_id: parsed.ids.requestId,
  }, parsed.expenseId, parsed.version + 1, {
    statuses: ["paid"], paymentReference,
  });
}

export async function handleExpenseCancel(
  request: Request, expenseIdInput: string, dependencies: ExpenseCommandDependencies,
) {
  const parsed = await lifecycleInput(
    request, expenseIdInput, dependencies, ["expectedVersion", "reason"],
  );
  if (!parsed.ok) return parsed.response;
  const reason = boundedText(parsed.value.reason, 500);
  if (!reason) return json({ error: "invalid_request" }, 400);
  return invoke(dependencies, "cancel_current_expense", {
    expense_public_id: parsed.expenseId,
    expected_version: parsed.version,
    reason,
    idempotency_key: parsed.ids.idempotencyKey,
    request_id: parsed.ids.requestId,
  }, parsed.expenseId, parsed.version + 1, { statuses: ["cancelled"] });
}

export async function defaultExpenseCommandDependencies(): Promise<ExpenseCommandDependencies> {
  const session = await getWorkspaceSession();
  const client = await getSupabaseServerClient();
  return {
    session,
    async rpc(name, args) {
      const { data, error } = await client.rpc(name, args);
      return { data, error };
    },
  };
}
