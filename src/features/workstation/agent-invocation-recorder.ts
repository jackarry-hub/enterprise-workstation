import type {
  AgentInvocationFinalizationPayload,
  AgentInvocationHandle,
  AgentInvocationStartPayload,
} from "@/features/ai-config/ai-chat-handler";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

type SupabaseLike = {
  from: (table: "agent_invocations") => {
    insert: (values: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => PromiseLike<{ data: { public_id?: unknown } | null; error: unknown }>;
      };
    };
  };
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validPublicUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function assertAuthorizedHeader(
  payload: AgentInvocationStartPayload,
  session: WorkspaceSession,
) {
  if (payload.actorMemberId !== session.member.id) throw new Error("agent_actor_mismatch");
  const agent = payload.authorizedAgent;
  if (payload.status !== "running" || !positiveInteger(agent.definitionId)
    || !positiveInteger(agent.versionDefinitionId)
    || !positiveInteger(agent.tenantId) || !positiveInteger(agent.organizationId)
    || payload.modelCode !== agent.model || payload.promptVersion !== agent.version
    || !payload.startedAt || !Array.isArray(agent.toolCodes)) {
    throw new Error("agent_authorization_invalid");
  }
  return agent;
}

export function createAgentInvocationRecorder(client: unknown, session: WorkspaceSession) {
  const supabase = client as SupabaseLike;
  let activeHeader: { invocationId: string; tenantId: number; organizationId: number } | null = null;

  return {
    async startAgentInvocation(payload: AgentInvocationStartPayload): Promise<AgentInvocationHandle> {
      const agent = assertAuthorizedHeader(payload, session);
      const result = await supabase.from("agent_invocations").insert({
        tenant_id: agent.tenantId,
        organization_id: agent.organizationId,
        agent_id: agent.definitionId,
        agent_version_id: agent.versionDefinitionId,
        actor_member_id: session.member.id,
        request_id: payload.requestId,
        status: "running",
        input_summary: payload.inputSummary,
        output_summary: "",
        model_code: agent.model,
        prompt_version: agent.version,
        tool_scope: { tools: [...agent.toolCodes] },
        input_tokens: 0,
        output_tokens: 0,
        cost_amount: 0,
        latency_ms: null,
        error_code: "",
        started_at: payload.startedAt,
        completed_at: null,
      }).select("public_id").single();
      if (result.error || !validPublicUuid(result.data?.public_id)) {
        throw new Error("agent_invocation_start_failed");
      }
      activeHeader = {
        invocationId: result.data.public_id,
        tenantId: agent.tenantId,
        organizationId: agent.organizationId,
      };
      return { invocationId: result.data.public_id };
    },

    async finalizeAgentInvocation(payload: AgentInvocationFinalizationPayload): Promise<void> {
      if (!activeHeader || payload.invocationId !== activeHeader.invocationId
        || !validPublicUuid(payload.invocationId) || !["succeeded", "failed"].includes(payload.status)) {
        throw new Error("agent_invocation_transition_invalid");
      }
      const result = await supabase.rpc("finalize_agent_invocation", {
        p_tenant_id: activeHeader.tenantId,
        p_organization_id: activeHeader.organizationId,
        p_invocation_public_id: payload.invocationId,
        p_status: payload.status,
        p_output_summary: payload.outputSummary,
        p_input_tokens: payload.inputTokens,
        p_output_tokens: payload.outputTokens,
        p_latency_ms: payload.latencyMs,
        p_error_code: payload.errorCode,
        p_completed_at: payload.completedAt,
      });
      if (result.error || typeof result.data !== "boolean") {
        throw new Error("agent_invocation_finalize_failed");
      }
    },
  };
}

export function createAgentInvocationReconciler(client: unknown) {
  const supabase = client as SupabaseLike;
  return async function reconcileStaleAgentInvocations(tenantId: number, cutoff: string, limit = 100) {
    if (!positiveInteger(tenantId) || !cutoff || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("agent_recovery_input_invalid");
    }
    const result = await supabase.rpc("recover_stale_agent_invocations", {
      p_tenant_id: tenantId,
      p_cutoff: cutoff,
      p_limit: limit,
    });
    if (result.error || !Array.isArray(result.data)) throw new Error("agent_recovery_failed");
    return result.data;
  };
}
