import { hashHighRiskPayload } from "@/features/ai-runtime/human-confirmation";
import { isHighRiskAction, type HighRiskAction, type HighRiskToolAdapter } from "@/features/ai-runtime/tool-adapter";

type RpcResult = { data: unknown; error: unknown };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>;

export type HighRiskDispatchInput = {
  tenantId: string;
  organizationId: string;
  actorId: number;
  authUserId: string;
  resourceId: string;
  action: HighRiskAction;
  payload: Record<string, unknown>;
  payloadHash: string;
  confirmationId?: string;
};

export type HighRiskDispatchDependencies = {
  serviceRpc: Rpc;
  adapters: Partial<Record<HighRiskAction, HighRiskToolAdapter>>;
};

type DispatchResult = { success: boolean; code: string; executionId?: string; result?: Record<string, unknown> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedSummary(value: Record<string, unknown>) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= 30_000 ? value : { truncated: true };
  } catch {
    return { invalid: true };
  }
}

export async function dispatchHighRiskTool(input: HighRiskDispatchInput, dependencies: HighRiskDispatchDependencies): Promise<DispatchResult> {
  if (!isHighRiskAction(input.action) || !UUID_PATTERN.test(input.tenantId) || !UUID_PATTERN.test(input.organizationId) || !UUID_PATTERN.test(input.authUserId)
    || !Number.isSafeInteger(input.actorId) || input.actorId <= 0 || !input.resourceId || input.resourceId.length > 200 || !HASH_PATTERN.test(input.payloadHash)) {
    return { success: false, code: "invalid_high_risk_request" };
  }
  if (hashHighRiskPayload(input.payload) !== input.payloadHash) return { success: false, code: "human_confirmation_mismatch" };
  if (!input.confirmationId || !UUID_PATTERN.test(input.confirmationId)) return { success: false, code: "human_confirmation_required" };
  const adapter = dependencies.adapters[input.action];
  if (!adapter || adapter.action !== input.action) return { success: false, code: "tool_adapter_unconfigured" };

  const claimed = await dependencies.serviceRpc("claim_ai_human_confirmation", {
    p_tenant_public_id: input.tenantId,
    p_organization_public_id: input.organizationId,
    p_actor_member_id: input.actorId,
    p_auth_user_id: input.authUserId,
    p_confirmation_public_id: input.confirmationId,
    p_resource_id: input.resourceId,
    p_action: input.action,
    p_payload_hash: input.payloadHash,
  });
  const claim = record(claimed.data);
  if (claimed.error || !claim) return { success: false, code: "human_confirmation_unavailable" };
  if (claim.claimed !== true) return { success: false, code: typeof claim.code === "string" ? claim.code : "human_confirmation_required" };
  const executionToken = String(claim.executionToken ?? "");
  const executionId = String(claim.executionId ?? "");
  if (!UUID_PATTERN.test(executionToken) || !UUID_PATTERN.test(executionId)) return { success: false, code: "human_confirmation_invalid_receipt" };

  let toolResult: { success: boolean; safeSummary: Record<string, unknown>; errorCode?: string };
  try {
    toolResult = await adapter.execute(input.payload, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      actorMemberId: input.actorId,
      authUserId: input.authUserId,
      resourceId: input.resourceId,
      confirmationId: input.confirmationId,
      executionId,
      idempotencyKey: input.confirmationId,
    });
  } catch {
    toolResult = { success: false, safeSummary: {}, errorCode: "tool_execution_failed" };
  }
  const safeSummary = boundedSummary(toolResult.safeSummary);
  const completed = await dependencies.serviceRpc("complete_ai_high_risk_execution", {
    p_confirmation_public_id: input.confirmationId,
    p_execution_token: executionToken,
    p_success: toolResult.success,
    p_result_summary: safeSummary,
    p_error_code: toolResult.errorCode ?? "",
  });
  const completion = record(completed.data);
  if (completed.error || !completion || !UUID_PATTERN.test(String(completion.executionId ?? ""))) {
    return { success: false, code: "execution_audit_failed", executionId };
  }
  return toolResult.success
    ? { success: true, code: "succeeded", executionId, result: safeSummary }
    : { success: false, code: toolResult.errorCode ?? "tool_execution_failed", executionId, result: safeSummary };
}
