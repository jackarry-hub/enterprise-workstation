// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createAgentInvocationRecorder } from "@/features/workstation/agent-invocation-recorder";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("createAgentInvocationRecorder", () => {
  it("records an agent invocation against the resolved internal agent row", async () => {
    const agentQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 91,
          tenant_id: 2,
          organization_id: 3,
          prompt_version: "v1",
        },
        error: null,
      }),
    };
    const invocationInsert = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === "agent_definitions") return agentQuery;
        if (table === "agent_invocations") return invocationInsert;
        throw new Error(`unexpected table ${table}`);
      }),
    };

    const record = createAgentInvocationRecorder(client as never, executiveWorkspaceSession);
    await record({
      agentPublicId: "33333333-3333-4333-8333-333333333333",
      actorMemberId: executiveWorkspaceSession.member.id,
      modelCode: "deepseek-chat",
      promptVersion: "",
      status: "succeeded",
      inputSummary: "输入摘要",
      outputSummary: "输出摘要",
      inputTokens: 30,
      outputTokens: 60,
      latencyMs: 800,
      errorCode: "",
    });

    expect(client.from).toHaveBeenCalledWith("agent_definitions");
    expect(agentQuery.select).toHaveBeenCalledWith("id, tenant_id, organization_id, prompt_version");
    expect(agentQuery.eq).toHaveBeenCalledWith("public_id", "33333333-3333-4333-8333-333333333333");
    expect(agentQuery.eq).toHaveBeenCalledWith("status", "enabled");
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
    });
  });

  it("throws when the target agent is missing or disabled", async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    };

    const record = createAgentInvocationRecorder(client as never, executiveWorkspaceSession);
    await expect(record({
      agentPublicId: "33333333-3333-4333-8333-333333333333",
      actorMemberId: executiveWorkspaceSession.member.id,
      modelCode: "deepseek-chat",
      promptVersion: "",
      status: "failed",
      inputSummary: "",
      outputSummary: "",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 10,
      errorCode: "upstream_failed",
    })).rejects.toThrow("agent_not_found");
  });
});
