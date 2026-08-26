// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createAgentInvocationReconciler,
  createAgentInvocationRecorder,
} from "@/features/workstation/agent-invocation-recorder";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const authorizedAgent = {
  definitionId: 91,
  tenantId: 2,
  organizationId: 3,
  version: "v1",
  systemPrompt: "server prompt",
  model: "deepseek-chat" as const,
  toolCodes: ["task.read"],
};

describe("createAgentInvocationRecorder", () => {
  it("persists the authorized running header before provider work and finalizes through a scoped transition RPC", async () => {
    const single = vi.fn().mockResolvedValue({ data: { public_id: "44444444-4444-4444-8444-444444444444" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const client = { from: vi.fn(() => ({ insert })), rpc };
    const lifecycle = createAgentInvocationRecorder(client as never, executiveWorkspaceSession);

    const handle = await lifecycle.startAgentInvocation({
      agentPublicId: "33333333-3333-4333-8333-333333333333",
      actorMemberId: executiveWorkspaceSession.member.id,
      modelCode: "deepseek-chat",
      promptVersion: "v1",
      status: "running",
      inputSummary: "输入摘要",
      startedAt: "2026-08-26T01:00:00.000Z",
      authorizedAgent,
    });
    await lifecycle.finalizeAgentInvocation({
      invocationId: handle.invocationId,
      status: "succeeded",
      outputSummary: "输出摘要",
      inputTokens: 30,
      outputTokens: 60,
      latencyMs: 800,
      errorCode: "",
      completedAt: "2026-08-26T01:00:00.800Z",
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 2,
      organization_id: 3,
      agent_id: 91,
      actor_member_id: executiveWorkspaceSession.member.id,
      status: "running",
      input_summary: "输入摘要",
      output_summary: "",
      model_code: "deepseek-chat",
      prompt_version: "v1",
      tool_scope: { tools: ["task.read"] },
      started_at: "2026-08-26T01:00:00.000Z",
      completed_at: null,
    }));
    expect(rpc).toHaveBeenCalledWith("finalize_agent_invocation", expect.objectContaining({
      p_tenant_id: 2,
      p_organization_id: 3,
      p_invocation_public_id: "44444444-4444-4444-8444-444444444444",
      p_status: "succeeded",
      p_output_summary: "输出摘要",
      p_completed_at: "2026-08-26T01:00:00.800Z",
    }));
  });

  it("treats a duplicate terminal transition as idempotent but rejects headers with caller-supplied scope", async () => {
    const single = vi.fn().mockResolvedValue({ data: { public_id: "44444444-4444-4444-8444-444444444444" }, error: null });
    const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const lifecycle = createAgentInvocationRecorder({ from: vi.fn(() => ({ insert })), rpc } as never, executiveWorkspaceSession);

    await expect(lifecycle.startAgentInvocation({
      agentPublicId: "33333333-3333-4333-8333-333333333333",
      actorMemberId: 999,
      modelCode: "deepseek-chat",
      promptVersion: "v1",
      status: "running",
      inputSummary: "",
      startedAt: "2026-08-26T01:00:00.000Z",
      authorizedAgent,
    })).rejects.toThrow("agent_actor_mismatch");

    await lifecycle.startAgentInvocation({
      agentPublicId: "33333333-3333-4333-8333-333333333333",
      actorMemberId: executiveWorkspaceSession.member.id,
      modelCode: "deepseek-chat",
      promptVersion: "v1",
      status: "running",
      inputSummary: "",
      startedAt: "2026-08-26T01:00:00.000Z",
      authorizedAgent,
    });

    const terminal = {
      invocationId: "44444444-4444-4444-8444-444444444444",
      status: "failed",
      outputSummary: "",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 10,
      errorCode: "upstream_timeout",
      completedAt: "2026-08-26T01:00:00.010Z",
    } as const;
    await expect(lifecycle.finalizeAgentInvocation(terminal)).resolves.toBeUndefined();
    await expect(lifecycle.finalizeAgentInvocation(terminal)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("leaves a started-only header recoverable after a process crash through the tenant-scoped reconciler", async () => {
    const single = vi.fn().mockResolvedValue({ data: { public_id: "44444444-4444-4444-8444-444444444444" }, error: null });
    const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = { from: vi.fn(() => ({ insert })), rpc };
    const lifecycle = createAgentInvocationRecorder(client as never, executiveWorkspaceSession);

    await lifecycle.startAgentInvocation({
      agentPublicId: "33333333-3333-4333-8333-333333333333",
      actorMemberId: executiveWorkspaceSession.member.id,
      modelCode: "deepseek-chat",
      promptVersion: "v1",
      status: "running",
      inputSummary: "crash before provider response",
      startedAt: "2026-08-26T01:00:00.000Z",
      authorizedAgent,
    });
    expect(rpc).not.toHaveBeenCalled();

    const recover = createAgentInvocationReconciler(client as never);
    await expect(recover(2, "2026-08-26T02:00:00.000Z", 10)).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith("recover_stale_agent_invocations", {
      p_tenant_id: 2,
      p_cutoff: "2026-08-26T02:00:00.000Z",
      p_limit: 10,
    });
  });
});
