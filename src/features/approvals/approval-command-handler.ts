import { randomUUID } from "node:crypto";

import { canonicalUuid, readStrictJson } from "@/app/api/workstation/tasks/handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };

export type ApprovalCommandDependencies = {
  session: { member: { status: string }; permissionCodes: readonly string[] } | null;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  createRequestId?: () => string;
};

const PUBLIC_FAILURES = new Set([
  "forbidden", "template_not_found", "approval_not_found", "invalid_form", "approver_unavailable",
  "invalid_state", "conflict", "scope_conflict",
]);
const APPROVAL_TYPES = new Set(["reimbursement", "purchase", "contract"]);
const APPROVAL_STATUSES = new Set(["pending"]);
const ACTION_COMMANDS = new Set(["approve", "reject", "return", "cancel"]);
const ACTION_STATUSES = new Set(["pending", "approved", "rejected", "returned", "cancelled"]);
const APPROVAL_CODE_PATTERN = /^AP-[0-9A-F]{20}$/;
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

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum
    ? value.trim() : null;
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

function failureStatus(error: string) {
  if (error === "forbidden") return 403;
  if (["template_not_found", "approval_not_found"].includes(error)) return 404;
  if (error === "invalid_form") return 422;
  if (["approver_unavailable", "invalid_state", "conflict", "scope_conflict"].includes(error)) return 409;
  return 503;
}

function canonicalApprovalAction(
  value: unknown,
  expectedId: string,
  expectedVersion: number,
  expectedCommand: string,
  expectedComment: string | null,
) {
  const root = record(value);
  if (!root || !exactKeys(root, ["outcome", "resource", "id", "version", "entity"])
    || root.outcome !== "success" || root.resource !== "approval") return null;
  const entity = record(root.entity);
  const lastAction = record(entity?.lastAction);
  const id = canonicalUuid(root.id);
  const version = root.version;
  const status = entity?.status;
  const currentStep = entity?.currentStep;
  const currentStepOrder = entity?.currentStepOrder;
  const ownerEmployeeId = entity?.ownerEmployeeId === null
    ? null : canonicalUuid(entity?.ownerEmployeeId);
  const completedAt = entity?.completedAt === null ? null : timestamp(entity?.completedAt);
  const actionComment = lastAction?.comment === null ? null : boundedText(lastAction?.comment, 500);
  if (!entity || !lastAction
    || !exactKeys(entity, [
      "id", "version", "status", "currentStep", "currentStepOrder", "ownerEmployeeId",
      "completedAt", "lastAction",
    ])
    || !exactKeys(lastAction, ["type", "comment", "actedAt"])
    || id !== expectedId || canonicalUuid(entity.id) !== id
    || !Number.isSafeInteger(version) || Number(version) !== expectedVersion + 1
    || entity.version !== version
    || typeof status !== "string" || !ACTION_STATUSES.has(status)
    || lastAction.type !== expectedCommand
    || (lastAction.comment !== null && !actionComment)
    || lastAction.comment !== expectedComment
    || !timestamp(lastAction.actedAt)) return null;
  const expectedStatuses = expectedCommand === "approve"
    ? new Set(["pending", "approved"])
    : new Set([expectedCommand === "reject" ? "rejected"
      : expectedCommand === "return" ? "returned" : "cancelled"]);
  if (!expectedStatuses.has(status)) return null;
  const pending = status === "pending";
  if (pending) {
    if (!boundedText(currentStep, 120) || !Number.isSafeInteger(currentStepOrder)
      || Number(currentStepOrder) < 1 || !ownerEmployeeId || completedAt !== null) return null;
  } else if (currentStep !== null || currentStepOrder !== null || entity.ownerEmployeeId !== null
    || !completedAt || Date.parse(completedAt) !== Date.parse(String(lastAction.actedAt))) return null;
  return {
    id, version: Number(version), status,
    currentStep: pending ? String(currentStep) : null,
    currentStepOrder: pending ? Number(currentStepOrder) : null,
    ownerEmployeeId: pending ? ownerEmployeeId : null,
    completedAt,
    lastAction: {
      type: expectedCommand,
      comment: actionComment,
      actedAt: String(lastAction.actedAt),
    },
  };
}

function canonicalApproval(value: unknown, expectedTemplateId: string) {
  const root = record(value);
  if (!root || !exactKeys(root, ["outcome", "resource", "id", "version", "entity"])
    || root.outcome !== "success" || root.resource !== "approval") return null;
  const entity = record(root.entity);
  const id = canonicalUuid(root.id);
  const entityId = canonicalUuid(entity?.id);
  const templateId = canonicalUuid(entity?.templateId);
  const version = root.version;
  if (!entity || !exactKeys(entity, [
    "id", "version", "approvalCode", "approvalType", "title", "status", "currentStep",
    "templateId", "templateVersion", "submittedAt",
  ]) || !id || entityId !== id || templateId !== expectedTemplateId
    || !Number.isSafeInteger(version) || Number(version) !== 1 || entity.version !== version
    || typeof entity.approvalCode !== "string" || !APPROVAL_CODE_PATTERN.test(entity.approvalCode)
    || entity.approvalCode !== `AP-${id.replaceAll("-", "").slice(0, 20).toUpperCase()}`
    || typeof entity.approvalType !== "string" || !APPROVAL_TYPES.has(entity.approvalType)
    || !boundedText(entity.title, 160)
    || typeof entity.status !== "string" || !APPROVAL_STATUSES.has(entity.status)
    || !boundedText(entity.currentStep, 120)
    || !Number.isSafeInteger(entity.templateVersion) || Number(entity.templateVersion) < 1
    || !timestamp(entity.submittedAt)) return null;
  return {
    id, version: 1, approvalCode: String(entity.approvalCode), approvalType: String(entity.approvalType),
    title: String(entity.title), status: "pending" as const, currentStep: String(entity.currentStep),
    templateId, templateVersion: Number(entity.templateVersion), submittedAt: String(entity.submittedAt),
  };
}

async function strictBody(request: Request) {
  const parsed = await readStrictJson(request);
  if (!parsed.ok) {
    const status = parsed.error === "unsupported_media_type" ? 415
      : parsed.error === "payload_too_large" ? 413 : 400;
    return { ok: false, response: json({ error: parsed.error }, status) } as const;
  }
  const value = record(parsed.value);
  return value
    ? { ok: true, value } as const
    : { ok: false, response: json({ error: "invalid_request" }, 400) } as const;
}

export async function handleApprovalSubmission(
  request: Request,
  dependencies: ApprovalCommandDependencies,
) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (dependencies.session.member.status !== "active"
    || !dependencies.session.permissionCodes.includes("approval.submit")) {
    return json({ error: "forbidden" }, 403);
  }
  const parsed = await strictBody(request);
  if (!parsed.ok) return parsed.response;
  if (!exactKeys(parsed.value, ["templateId", "formData"])) return json({ error: "invalid_request" }, 400);
  const templateId = canonicalUuid(parsed.value.templateId);
  const formData = record(parsed.value.formData);
  const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
  if (!templateId || !formData || !idempotencyKey || Object.keys(formData).length > 50) {
    return json({ error: "invalid_request" }, 400);
  }
  let rpcResult: RpcResult;
  try {
    rpcResult = await dependencies.rpc("submit_current_approval", {
      template_public_id: templateId, form_data: formData, idempotency_key: idempotencyKey,
      request_id: dependencies.createRequestId?.() ?? randomUUID(),
    });
  } catch {
    return json({ error: "approval_command_unavailable" }, 503);
  }
  if (rpcResult.error) {
    return rpcResult.error.code === "42501" ? json({ error: "forbidden" }, 403)
      : json({ error: "approval_command_unavailable" }, 503);
  }
  const failure = record(rpcResult.data);
  if (failure?.outcome === "failure" && exactKeys(failure, ["outcome", "error"])
    && typeof failure.error === "string" && PUBLIC_FAILURES.has(failure.error)) {
    return json({ error: failure.error }, failureStatus(failure.error));
  }
  const approval = canonicalApproval(rpcResult.data, templateId);
  return approval ? json({ outcome: "success", resource: "approval", approval }, 201)
    : json({ error: "approval_command_unavailable" }, 503);
}

export async function handleApprovalAction(
  request: Request,
  approvalIdInput: string,
  dependencies: ApprovalCommandDependencies,
) {
  if (!dependencies.session) return json({ error: "unauthorized" }, 401);
  if (dependencies.session.member.status !== "active") return json({ error: "forbidden" }, 403);
  const approvalId = canonicalUuid(approvalIdInput);
  const parsed = await strictBody(request);
  if (!parsed.ok) return parsed.response;
  if (!approvalId || !exactKeys(parsed.value, ["command", "expectedVersion", "comment"])) {
    return json({ error: "invalid_request" }, 400);
  }
  const command = typeof parsed.value.command === "string" ? parsed.value.command : "";
  const expectedVersion = parsed.value.expectedVersion;
  const rawComment = parsed.value.comment;
  const comment = rawComment === null ? null : boundedText(rawComment, 500);
  const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
  if (!ACTION_COMMANDS.has(command) || !Number.isSafeInteger(expectedVersion)
    || Number(expectedVersion) < 1 || Number(expectedVersion) > 2_147_483_647 || !idempotencyKey
    || (rawComment !== null && !comment)
    || (command !== "approve" && !comment)) {
    return json({ error: "invalid_request" }, 400);
  }
  let rpcResult: RpcResult;
  try {
    rpcResult = await dependencies.rpc("act_on_current_approval", {
      approval_public_id: approvalId,
      command,
      expected_version: Number(expectedVersion),
      comment,
      request_id: idempotencyKey,
    });
  } catch {
    return json({ error: "approval_command_unavailable" }, 503);
  }
  if (rpcResult.error) {
    return rpcResult.error.code === "42501" ? json({ error: "forbidden" }, 403)
      : json({ error: "approval_command_unavailable" }, 503);
  }
  const failure = record(rpcResult.data);
  if (failure?.outcome === "failure" && exactKeys(failure, ["outcome", "error"])
    && typeof failure.error === "string" && PUBLIC_FAILURES.has(failure.error)) {
    return json({ error: failure.error }, failureStatus(failure.error));
  }
  const approval = canonicalApprovalAction(
    rpcResult.data, approvalId, Number(expectedVersion), command, comment,
  );
  return approval ? json({ outcome: "success", resource: "approval", approval })
    : json({ error: "approval_command_unavailable" }, 503);
}

export async function defaultApprovalCommandDependencies(): Promise<ApprovalCommandDependencies> {
  const session = await getWorkspaceSession();
  const client = await getSupabaseServerClient();
  return { session, async rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    return { data, error };
  } };
}
