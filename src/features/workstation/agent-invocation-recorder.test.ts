// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createAgentInvocationRecorder } from "@/features/workstation/agent-invocation-recorder";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("createAgentInvocationRecorder", () => {
  it("appends only the already-authorized numeric Agent scope and session actor", async () => {
    const invocationInsert = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === "agent_invocations") return invocationInsert;
        throw new Error(`unexpected table ${table}`);
      }),
    };

    const record = createAgentInvocationRecorder(client as never, executiveWorkspaceSession);
    await record({
      agentPublicId: "33333333-3333-4333-8333-333333333333",
      actorMemberId: executiveWorkspaceSession.member.id,
      modelCode: "deepseek-chat",
      promptVersion: "v1",
      status: "succeeded",
      inputSummary: "输入摘要",
      outputSummary: "输出摘要",
      inputTokens: 30,
      outputTokens: 60,
      latencyMs: 800,
      errorCode: "",
      startedAt: "2026-08-26T01:00:00.000Z",
      completedAt: "2026-08-26T01:00:00.800Z",
      authorizedAgent: {
        definitionId: 91,
        tenantId: 2,
        organizationId: 3,
        version: "v1",
        systemPrompt: "server prompt",
        model: "deepseek-chat",
        toolCodes: [],
      },
    });

    expect(client.from).toHaveBeenCalledWith("agent_invocations");
    expect(invocationInsert.insert).toHaveBeenCalledWith({
      tenant_id: 2,
      organization_id: 3,
      agent_id: 91,
      actor_member_id: executiveWorkspaceSession.member.id,
      status: "succeeded",
      input_summary: "输入摘要",
      output_summary: "输出摘要",
      model_code: "deepseek-chat",
      prompt_version: "v1",
      input_tokens: 30,
      output_tokens: 60,
      cost_amount: 0,
      latency_ms: 800,
      error_code: "",
      started_at: "2026-08-26T01:00:00.000Z",
      completed_at: "2026-08-26T01:00:00.800Z",
    });
  });

  it("refuses a payload with mismatched actor or malformed authorized scope", async () => {
    const client = {
      from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) })),
    };

    const record = createAgentInvocationRecorder(client as never, executiveWorkspaceSession);
    await expect(record({
      agentPublicId: "33333333-3333-4333-8333-333333333333",
      actorMemberId: 999,
      modelCode: "deepseek-chat",
      promptVersion: "",
      status: "failed",
      inputSummary: "",
      outputSummary: "",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 10,
      errorCode: "upstream_failed",
      startedAt: "2026-08-26T01:00:00.000Z",
      completedAt: "2026-08-26T01:00:00.010Z",
      authorizedAgent: {
        definitionId: 91, tenantId: 2, organizationId: 3, version: "v1",
        systemPrompt: "server prompt", model: "deepseek-chat", toolCodes: [],
      },
    })).rejects.toThrow("agent_actor_mismatch");
  });
});
