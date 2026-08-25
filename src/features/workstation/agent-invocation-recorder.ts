import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import type { AgentInvocationLogPayload } from "@/features/ai-config/ai-chat-handler";

type SupabaseLike = {
  from: (table: string) => SupabaseTableLike;
};

type AgentLookupResult = {
  data: {
    id: number;
    tenant_id: number;
    organization_id: number;
    prompt_version: string | null;
  } | null;
  error: unknown;
};

type SupabaseTableLike = {
  select: (columns: string) => SupabaseFilterLike;
  insert: (values: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
};

type SupabaseFilterLike = {
  eq: (column: string, value: unknown) => SupabaseFilterLike;
  is: (column: string, value: unknown) => SupabaseFilterLike;
  maybeSingle: () => Promise<AgentLookupResult>;
};

export function createAgentInvocationRecorder(
  client: unknown,
  session: WorkspaceSession,
) {
  const supabase = client as SupabaseLike;

  return async function recordAgentInvocation(payload: AgentInvocationLogPayload) {
    if (payload.actorMemberId !== session.member.id) {
      throw new Error("agent_actor_mismatch");
    }

    const { data: agent, error: agentError } = await supabase.from("agent_definitions")
      .select("id, tenant_id, organization_id, prompt_version")
      .eq("public_id", payload.agentPublicId)
      .eq("status", "enabled")
      .is("deleted_at", null)
      .maybeSingle();

    if (agentError) throw new Error("agent_lookup_failed");
    if (!agent) throw new Error("agent_not_found");

    const insertResult = await supabase.from("agent_invocations").insert({
      tenant_id: agent.tenant_id,
      organization_id: agent.organization_id,
      agent_id: agent.id,
      actor_member_id: payload.actorMemberId,
      status: payload.status,
      input_summary: payload.inputSummary,
      output_summary: payload.outputSummary,
      model_code: payload.modelCode,
      prompt_version: payload.promptVersion || agent.prompt_version || "",
      input_tokens: payload.inputTokens,
      output_tokens: payload.outputTokens,
      cost_amount: 0,
      latency_ms: payload.latencyMs,
      error_code: payload.errorCode,
    });

    if (!insertResult || insertResult.error) {
      throw new Error("agent_invocation_insert_failed");
    }
  };
}
