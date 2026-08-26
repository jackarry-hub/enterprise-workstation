import type { AgentInvocationLogPayload } from "@/features/ai-config/ai-chat-handler";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

type SupabaseLike = {
  from: (table: "agent_invocations") => {
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
};

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function createAgentInvocationRecorder(
  client: unknown,
  session: WorkspaceSession,
) {
  const supabase = client as SupabaseLike;

  return async function recordAgentInvocation(payload: AgentInvocationLogPayload) {
    if (payload.actorMemberId !== session.member.id) {
      throw new Error("agent_actor_mismatch");
    }

    const agent = payload.authorizedAgent;
    if (!positiveInteger(agent.definitionId) || !positiveInteger(agent.tenantId)
      || !positiveInteger(agent.organizationId) || !agent.version.trim()
      || payload.modelCode !== agent.model || payload.promptVersion !== agent.version) {
      throw new Error("agent_authorization_invalid");
    }

    const insertResult = await supabase.from("agent_invocations").insert({
      tenant_id: agent.tenantId,
      organization_id: agent.organizationId,
      agent_id: agent.definitionId,
      actor_member_id: session.member.id,
      status: payload.status,
      input_summary: payload.inputSummary,
      output_summary: payload.outputSummary,
      model_code: agent.model,
      prompt_version: agent.version,
      input_tokens: payload.inputTokens,
      output_tokens: payload.outputTokens,
      cost_amount: 0,
      latency_ms: payload.latencyMs,
      error_code: payload.errorCode,
      started_at: payload.startedAt,
      completed_at: payload.completedAt,
    });

    if (!insertResult || insertResult.error) {
      throw new Error("agent_invocation_insert_failed");
    }
  };
}
