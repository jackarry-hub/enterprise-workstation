import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

type RpcResult = { data: unknown; error: unknown };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };

type RuntimeStatus = "succeeded" | "failed" | "timed_out" | "rate_limited";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createAiRuntimeStore(client: unknown, session: WorkspaceSession) {
  const rpcClient = client as RpcClient;
  const scope = {
    p_tenant_public_id: session.tenantId,
    p_organization_public_id: session.organization.id,
    p_actor_member_id: session.member.id,
    p_auth_user_id: session.authUserId,
  };
  return {
    async consume(operation: string, requestId: string, windowSeconds = 60, limitCount = 30) {
      const result = await rpcClient.rpc("consume_ai_rate_limit", { ...scope, p_operation: operation, p_window_seconds: windowSeconds, p_limit_count: limitCount, p_request_id: requestId });
      const data = record(result.data);
      if (result.error || !data || typeof data.allowed !== "boolean") throw new Error("ai_rate_limit_unavailable");
      return { allowed: data.allowed, remaining: Number(data.remaining ?? 0), resetAt: String(data.resetAt ?? "") };
    },
    async start(requestId: string, operation: string, modelCode: string, startedAt: string) {
      const result = await rpcClient.rpc("start_ai_runtime_invocation", { ...scope, p_request_id: requestId, p_operation: operation, p_model_code: modelCode, p_started_at: startedAt });
      const data = record(result.data);
      if (result.error || !data || !uuid(data.invocationId)) throw new Error("ai_invocation_start_failed");
      return { invocationId: data.invocationId };
    },
    async finalize(invocationId: string, status: RuntimeStatus, usage: { inputTokens: number; outputTokens: number }, errorCode: string, completedAt: string, costAmount: number | null = null) {
      const canonicalError = errorCode === "upstream_auth_failed" ? "ai_provider_unauthorized" : errorCode;
      const result = await rpcClient.rpc("finalize_ai_runtime_invocation", {
        ...scope, p_invocation_public_id: invocationId, p_status: status, p_input_tokens: usage.inputTokens,
        p_output_tokens: usage.outputTokens, p_cost_amount: costAmount, p_error_code: canonicalError, p_completed_at: completedAt,
      });
      const data = record(result.data);
      if (result.error || !data || data.status !== status) throw new Error("ai_invocation_finalize_failed");
    },
  };
}

export type AiRuntimeStore = ReturnType<typeof createAiRuntimeStore>;
