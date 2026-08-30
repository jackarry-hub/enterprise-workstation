import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { handleOrchestrationRuns, topologicallyOrderRuntimeNodes } from "@/features/agents/orchestration-runtime-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const orchestrationId = "11111111-1111-4111-8111-111111111111"; const runId = "22222222-2222-4222-8222-222222222222"; const requestId = "33333333-3333-4333-8333-333333333333";
const agentA = "44444444-4444-4444-8444-444444444444"; const agentB = "55555555-5555-4555-8555-555555555555"; const versionA = "66666666-6666-4666-8666-666666666666"; const versionB = "77777777-7777-4777-8777-777777777777"; const nodeRequestA = "88888888-8888-4888-8888-888888888888"; const nodeRequestB = "99999999-9999-4999-8999-999999999999";
const orchestrator = { ...executiveWorkspaceSession, permissionCodes: [...executiveWorkspaceSession.permissionCodes, "agent.orchestrate" as const] };
const nodes = [{ key: "prepare", sequence: 2, agentId: agentA, agentVersionId: versionA, requestId: nodeRequestA, maxDepth: 3 }, { key: "deliver", sequence: 1, agentId: agentB, agentVersionId: versionB, requestId: nodeRequestB, maxDepth: 3 }];

describe("Agent orchestration runtime", () => {
  it("persists pinned append-only run and node evidence behind service-only RPCs", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202608300016_agent_orchestration_runtime.sql"), "utf8").toLowerCase();
    for (const marker of ["agent_orchestration_runs_append_only", "agent_orchestration_node_runs_append_only", "orchestration_pinned_version_stale", "record_agent_orchestration_node_result", "to service_role"]) expect(sql).toContain(marker);
    expect(sql).toContain("v_node_count not between 1 and 8");
  });

  it("uses graph dependencies rather than authoring order", () => {
    expect(topologicallyOrderRuntimeNodes(nodes, [{ from: "prepare", to: "deliver" }])?.map(({ key }) => key)).toEqual(["prepare", "deliver"]);
    expect(topologicallyOrderRuntimeNodes(nodes, [{ from: "prepare", to: "deliver" }, { from: "deliver", to: "prepare" }])).toBeNull();
  });

  it("executes every pinned node through the real Agent boundary and finalizes once", async () => {
    const serviceRpc = vi.fn(async (name: string) => {
      if (name === "start_agent_orchestration_run") return { data: { runId, status: "running", alreadyExists: false, graph: { nodes, edges: [{ from: "prepare", to: "deliver" }] } }, error: null };
      if (name === "record_agent_orchestration_node_result") return { data: { status: "succeeded" }, error: null };
      if (name === "finalize_agent_orchestration_run") return { data: { runId, status: "succeeded", outputSummary: "完成" }, error: null };
      return { data: null, error: { code: "unknown" } };
    });
    let invocation = 0; const invokeAgent = vi.fn(async (agentRequest: Request, agentId: string) => { void agentRequest; void agentId; invocation += 1; return Response.json({ run: { id: `${invocation === 1 ? "a" : "b"}0000000-0000-4000-8000-000000000000`, status: "succeeded", outputSummary: invocation === 1 ? "准备完成" : "交付完成" } }); });
    const response = await handleOrchestrationRuns(new Request("https://q.test/api/workstation/agent-orchestrations/x/runs", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": requestId }, body: JSON.stringify({ input: "完成客户交付" }) }), orchestrationId, { loadSession: async () => orchestrator, userRpc: vi.fn(), serviceRpc, invokeAgent });
    expect(response.status).toBe(201); expect(invokeAgent).toHaveBeenCalledTimes(2); expect(serviceRpc.mock.calls.map(([name]) => name)).toEqual(["start_agent_orchestration_run", "record_agent_orchestration_node_result", "record_agent_orchestration_node_result", "finalize_agent_orchestration_run"]);
    const secondRequest = invokeAgent.mock.calls[1][0] as Request; expect(await secondRequest.clone().json()).toMatchObject({ input: expect.stringContaining("准备完成") });
  });

  it("does not execute an in-flight idempotent run twice", async () => {
    const invokeAgent = vi.fn(); const response = await handleOrchestrationRuns(new Request("https://q.test", { method: "POST", body: JSON.stringify({ input: "再次执行" }) }), orchestrationId, { loadSession: async () => orchestrator, userRpc: vi.fn(), serviceRpc: vi.fn().mockResolvedValue({ data: { runId, status: "running", alreadyExists: true, graph: { nodes, edges: [] } }, error: null }), invokeAgent, createRequestId: () => requestId });
    expect(response.status).toBe(409); expect(invokeAgent).not.toHaveBeenCalled();
  });
});
