import { randomUUID } from "node:crypto";

import { handleAgentRuns } from "@/features/agents/agent-runtime-handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
type GraphNode = { key: string; sequence: number; agentId: string; agentVersionId: string; requestId: string; maxDepth: number };
type GraphEdge = { from: string; to: string };
type RunReceipt = { runId: string; status: string; alreadyExists: boolean; graph: { nodes: GraphNode[]; edges: GraphEdge[] }; outputSummary?: string; errorCode?: string };
export type OrchestrationRuntimeDependencies = {
  loadSession: () => Promise<WorkspaceSession | null>;
  userRpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  serviceRpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  invokeAgent: (request: Request, agentId: string) => Promise<Response>;
  createRequestId?: () => string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
function rpcStatus(error: RpcResult["error"]) { return error?.code === "42501" ? 403 : error?.code === "P0002" ? 404 : ["23505", "55000"].includes(error?.code ?? "") ? 409 : error?.code === "22023" ? 422 : 503; }
function parseReceipt(value: unknown): RunReceipt | null {
  const item = record(value); const graph = record(item?.graph); const nodes = Array.isArray(graph?.nodes) ? graph.nodes.map(record) : []; const edges = Array.isArray(graph?.edges) ? graph.edges.map(record) : [];
  if (!item || !UUID.test(String(item.runId ?? "")) || !nodes.every(Boolean) || !edges.every(Boolean)) return null;
  const parsedNodes = nodes.map((node) => ({ key: String(node!.key ?? ""), sequence: Number(node!.sequence), agentId: String(node!.agentId ?? ""), agentVersionId: String(node!.agentVersionId ?? ""), requestId: String(node!.requestId ?? ""), maxDepth: Number(node!.maxDepth) }));
  const parsedEdges = edges.map((edge) => ({ from: String(edge!.from ?? ""), to: String(edge!.to ?? "") }));
  if (parsedNodes.length < 1 || parsedNodes.length > 8 || parsedNodes.some((node) => !node.key || !UUID.test(node.agentId) || !UUID.test(node.agentVersionId) || !UUID.test(node.requestId) || !Number.isSafeInteger(node.sequence) || node.maxDepth < 1) || parsedEdges.some((edge) => !edge.from || !edge.to)) return null;
  return { runId: String(item.runId), status: String(item.status ?? ""), alreadyExists: item.alreadyExists === true, graph: { nodes: parsedNodes, edges: parsedEdges }, outputSummary: typeof item.outputSummary === "string" ? item.outputSummary : undefined, errorCode: typeof item.errorCode === "string" ? item.errorCode : undefined };
}

export function topologicallyOrderRuntimeNodes(nodes: readonly GraphNode[], edges: readonly GraphEdge[]) {
  const byKey = new Map(nodes.map((node) => [node.key, node])); const incoming = new Map(nodes.map((node) => [node.key, 0])); const outgoing = new Map<string, string[]>();
  for (const edge of edges) { if (!byKey.has(edge.from) || !byKey.has(edge.to) || edge.from === edge.to) return null; incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1); outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]); }
  const queue = nodes.filter((node) => incoming.get(node.key) === 0).sort((a, b) => a.sequence - b.sequence); const order: GraphNode[] = [];
  while (queue.length) { const node = queue.shift()!; order.push(node); for (const target of outgoing.get(node.key) ?? []) { const count = (incoming.get(target) ?? 0) - 1; incoming.set(target, count); if (count === 0) { queue.push(byKey.get(target)!); queue.sort((a, b) => a.sequence - b.sequence); } } }
  return order.length === nodes.length ? order : null;
}

async function defaults(): Promise<OrchestrationRuntimeDependencies> {
  const user = await getSupabaseServerClient(); const service = getSupabaseServiceRoleClient();
  return { loadSession: getWorkspaceSession, userRpc: async (name, args) => await user.rpc(name, args) as RpcResult, serviceRpc: async (name, args) => await service.rpc(name, args) as RpcResult, invokeAgent: handleAgentRuns };
}

export async function handleOrchestrationRuns(request: Request, orchestrationId: string, provided?: OrchestrationRuntimeDependencies) {
  if (!UUID.test(orchestrationId)) return json({ error: "not_found" }, 404); const deps = provided ?? await defaults(); const session = await deps.loadSession(); if (!session) return json({ error: "unauthenticated" }, 401); if (!session.permissionCodes.includes("agent.orchestrate")) return json({ error: "forbidden" }, 403);
  if (request.method === "GET") { const result = await deps.userRpc("list_current_agent_orchestration_runs", { p_orchestration_public_id: orchestrationId, p_limit: 50 }); if (result.error) { const status = rpcStatus(result.error); return json({ error: status === 404 ? "not_found" : "orchestration_runtime_unavailable" }, status); } return json(record(result.data) ?? { items: [] }); }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await request.text(); if (Buffer.byteLength(raw, "utf8") > 16_384) return json({ error: "invalid_request" }, 400); let value: Record<string, unknown> | null = null; try { value = record(JSON.parse(raw)); } catch { /* invalid */ }
  const input = typeof value?.input === "string" ? value.input.trim() : record(value?.input) ? JSON.stringify(value?.input) : ""; const requestId = request.headers.get("idempotency-key")?.toLowerCase() ?? deps.createRequestId?.() ?? randomUUID();
  if (!input || Buffer.byteLength(input, "utf8") > 12_000 || !UUID.test(requestId)) return json({ error: "invalid_request" }, 400);
  const started = await deps.serviceRpc("start_agent_orchestration_run", { p_tenant_public_id: session.tenantId, p_organization_public_id: session.organization.id, p_actor_member_id: session.member.id, p_auth_user_id: session.authUserId, p_orchestration_public_id: orchestrationId, p_input_summary: input.replace(/\s+/g, " ").slice(0, 600), p_request_id: requestId });
  if (started.error) { const status = rpcStatus(started.error); return json({ error: status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 409 ? "orchestration_conflict" : status === 422 ? "orchestration_too_large" : "orchestration_runtime_unavailable" }, status); }
  const receipt = parseReceipt(started.data); if (!receipt) return json({ error: "orchestration_runtime_unavailable" }, 503);
  if (receipt.alreadyExists) return json({ run: receipt, alreadyExists: true }, ["succeeded", "failed"].includes(receipt.status) ? 200 : 409);
  const ordered = topologicallyOrderRuntimeNodes(receipt.graph.nodes, receipt.graph.edges); if (!ordered) { await finalize(deps, receipt.runId, "failed", "", "orchestration_graph_invalid"); return json({ error: "orchestration_graph_invalid", runId: receipt.runId }, 503); }
  const outputs = new Map<string, string>();
  for (const node of ordered) {
    const predecessors = receipt.graph.edges.filter((edge) => edge.to === node.key).map((edge) => [edge.from, outputs.get(edge.from) ?? ""] as const); const nodeInput = JSON.stringify({ workflowInput: input, predecessors: Object.fromEntries(predecessors) }); const nodeStartedAt = new Date().toISOString();
    let agentResponse: Response; let agentPayload: Record<string, unknown> = {}; try { const headers = new Headers(request.headers); headers.set("content-type", "application/json"); headers.set("idempotency-key", node.requestId); agentResponse = await deps.invokeAgent(new Request(new URL(`/api/workstation/agents/${node.agentId}/runs`, request.url), { method: "POST", headers, body: JSON.stringify({ input: nodeInput }) }), node.agentId); agentPayload = record(await agentResponse.json()) ?? {}; } catch { agentResponse = json({ error: "agent_run_unavailable" }, 503); }
    const run = record(agentPayload.run); const invocationId = typeof run?.id === "string" && UUID.test(run.id) ? run.id : null; const succeeded = agentResponse.ok && run?.status === "succeeded"; const output = typeof run?.outputSummary === "string" ? run.outputSummary : ""; const errorCode = succeeded ? "" : String(agentPayload.error ?? run?.errorCode ?? "agent_node_failed").slice(0, 120); const completedAt = new Date().toISOString();
    const recorded = await deps.serviceRpc("record_agent_orchestration_node_result", { p_run_public_id: receipt.runId, p_node_key: node.key, p_status: succeeded ? "succeeded" : "failed", p_agent_invocation_public_id: invocationId, p_output_summary: output.slice(0, 600), p_error_code: errorCode, p_started_at: nodeStartedAt, p_completed_at: completedAt });
    if (recorded.error) { await finalize(deps, receipt.runId, "failed", "", "orchestration_audit_failed"); return json({ error: "orchestration_audit_failed", runId: receipt.runId }, 503); }
    if (!succeeded) { const terminal = await finalize(deps, receipt.runId, "failed", "", errorCode); return json({ run: terminal, error: errorCode, requestId }, agentResponse.status >= 400 ? agentResponse.status : 502); }
    outputs.set(node.key, output);
  }
  const sinkKeys = ordered.filter((node) => !receipt.graph.edges.some((edge) => edge.from === node.key)).map((node) => node.key); const summary = sinkKeys.map((key) => outputs.get(key) ?? "").filter(Boolean).join("\n").slice(0, 600); const terminal = await finalize(deps, receipt.runId, "succeeded", summary, "");
  return json({ run: terminal, requestId }, 201);
}

async function finalize(deps: OrchestrationRuntimeDependencies, runId: string, status: "succeeded" | "failed", outputSummary: string, errorCode: string) {
  const result = await deps.serviceRpc("finalize_agent_orchestration_run", { p_run_public_id: runId, p_status: status, p_output_summary: outputSummary, p_error_code: errorCode, p_completed_at: new Date().toISOString() });
  return result.error ? { runId, status: "failed", errorCode: "orchestration_finalization_failed" } : record(result.data) ?? { runId, status, outputSummary, errorCode };
}
