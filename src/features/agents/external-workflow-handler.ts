import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import {
  EXTERNAL_WORKFLOW_CATALOG,
  findExternalWorkflow,
  providerCredentialName,
  providerLabel,
  type ExternalWorkflowDefinition,
  type ExternalWorkflowProvider,
} from "@/features/agents/external-workflow-catalog";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
type ExternalFetch = (input: string, init: RequestInit) => Promise<Response>;
export type ExternalWorkflowDependencies = {
  loadSession: () => Promise<WorkspaceSession | null>;
  userRpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  serviceRpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  fetchExternal: ExternalFetch;
  credential: (provider: ExternalWorkflowProvider) => string | null;
  createRequestId?: () => string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIZES = new Set(["1536x1024", "1024x1536", "1024x1024"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 48 * 1024 * 1024;
const MAX_IMAGES = 8;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function rpcStatus(error: RpcResult["error"]) { return error?.code === "42501" ? 403 : error?.code === "P0002" ? 404 : ["23505", "55000"].includes(error?.code ?? "") ? 409 : error?.code === "22023" ? 422 : 503; }

async function defaults(): Promise<ExternalWorkflowDependencies> {
  const user = await getSupabaseServerClient(); const service = getSupabaseServiceRoleClient();
  return {
    loadSession: getWorkspaceSession,
    userRpc: async (name, args) => await user.rpc(name, args) as RpcResult,
    serviceRpc: async (name, args) => await service.rpc(name, args) as RpcResult,
    fetchExternal: fetch,
    credential: (provider) => process.env[providerCredentialName(provider)]?.trim() || null,
  };
}

type ConnectionStatus = "ready" | "unverified" | "unconfigured";

function publicWorkflow(workflow: ExternalWorkflowDefinition, connectionStatus: ConnectionStatus) {
  return {
    ...workflow,
    providerLabel: providerLabel(workflow.provider),
    connectionStatus,
    nativeRunEnabled: connectionStatus === "ready",
  };
}

export async function handleExternalWorkflowCollection(request: Request, provided?: ExternalWorkflowDependencies) {
  const deps = provided ?? await defaults(); const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const providers: ExternalWorkflowProvider[] = ["image-studio", "content-workbench"];
  const states = new Map(await Promise.all(providers.map(async (provider) => [provider, await probeConnection(provider, deps.credential(provider), deps.fetchExternal)] as const)));
  const items = EXTERNAL_WORKFLOW_CATALOG.map((workflow) => publicWorkflow(workflow, states.get(workflow.provider) ?? "unconfigured"));
  return json({ items, canManage: session.permissionCodes.includes("agent.manage") });
}

export async function handleExternalWorkflowRuns(request: Request, workflowCode: string, provided?: ExternalWorkflowDependencies) {
  const workflow = findExternalWorkflow(workflowCode);
  if (!workflow) return json({ error: "not_found" }, 404);
  const deps = provided ?? await defaults(); const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (request.method === "GET") {
    const listed = await deps.userRpc("list_current_external_workflow_runs", { p_workflow_code: workflow.code, p_limit: 50 });
    if (listed.error) { const status = rpcStatus(listed.error); return json({ error: status === 403 ? "forbidden" : "workflow_runs_unavailable" }, status); }
    return json(record(listed.data) ?? { items: [] });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = deps.credential(workflow.provider);
  if (!token) return json({ error: "workflow_connection_unconfigured", launchUrl: workflow.launchUrl }, 503);
  const requestId = request.headers.get("idempotency-key")?.toLowerCase() ?? deps.createRequestId?.() ?? randomUUID();
  if (!UUID.test(requestId)) return json({ error: "invalid_request" }, 400);

  const parsed = workflow.provider === "image-studio" ? await parseImageRequest(request, workflow) : await parseContentRequest(request, workflow);
  if (!parsed) return json({ error: "invalid_request" }, 400);
  const started = await deps.serviceRpc("start_external_workflow_run", {
    p_tenant_public_id: session.tenantId,
    p_organization_public_id: session.organization.id,
    p_actor_member_id: session.member.id,
    p_auth_user_id: session.authUserId,
    p_workflow_code: workflow.code,
    p_provider_code: workflow.provider,
    p_input_summary: parsed.summary,
    p_request_id: requestId,
  });
  if (started.error) { const status = rpcStatus(started.error); return json({ error: status === 403 ? "forbidden" : status === 409 ? "workflow_run_conflict" : "workflow_runtime_unavailable" }, status); }
  const receipt = record(started.data); const runId = String(receipt?.runId ?? "");
  if (!UUID.test(runId)) return json({ error: "workflow_runtime_unavailable" }, 503);
  if (receipt?.alreadyExists === true) return json({ run: receipt, alreadyExists: true }, ["succeeded", "failed"].includes(String(receipt.status)) ? 200 : 409);

  try {
    const upstream = await invoke(workflow, parsed.body, token, deps.fetchExternal);
    const upstreamBody = await readLimitedJson(upstream);
    const upstreamRecord = record(upstreamBody); const upstreamRunId = firstIdentifier(upstreamRecord);
    const summary = upstream.ok
      ? `已提交到${providerLabel(workflow.provider)}${upstreamRunId ? `，任务 ${upstreamRunId}` : ""}`
      : String(upstreamRecord?.message ?? upstreamRecord?.error ?? `上游请求失败（${upstream.status}）`).slice(0, 600);
    const terminal = await deps.serviceRpc("finalize_external_workflow_run", {
      p_run_public_id: runId,
      p_status: upstream.ok ? "succeeded" : "failed",
      p_upstream_run_id: upstreamRunId,
      p_output_summary: upstream.ok ? summary : "",
      p_error_code: upstream.ok ? "" : `upstream_${upstream.status}`,
      p_completed_at: new Date().toISOString(),
    });
    if (terminal.error) return json({ error: "workflow_audit_failed", runId }, 503);
    return json({ run: record(terminal.data) ?? { runId, status: upstream.ok ? "succeeded" : "failed", outputSummary: summary }, requestId }, upstream.ok ? 201 : 502);
  } catch (error) {
    const code = error instanceof Error && error.message === "response_too_large" ? "upstream_response_too_large" : error instanceof Error && error.name === "AbortError" ? "upstream_timeout" : "upstream_unavailable";
    await deps.serviceRpc("finalize_external_workflow_run", { p_run_public_id: runId, p_status: "failed", p_upstream_run_id: null, p_output_summary: "", p_error_code: code, p_completed_at: new Date().toISOString() });
    return json({ error: code, runId, launchUrl: workflow.launchUrl }, 503);
  }
}

async function parseContentRequest(request: Request, workflow: ExternalWorkflowDefinition) {
  const raw = await request.text(); if (Buffer.byteLength(raw, "utf8") > 16_384) return null;
  let value: Record<string, unknown> | null = null; try { value = record(JSON.parse(raw)); } catch { return null; }
  const input = typeof value?.input === "string" ? value.input.trim() : "";
  if (!input || Buffer.byteLength(input, "utf8") > 12_000) return null;
  return { summary: `${Array.from(input).length} 字符任务目标`, body: JSON.stringify({ workflowKey: workflow.code, input }) };
}

async function parseImageRequest(request: Request, workflow: ExternalWorkflowDefinition) {
  let form: FormData; try { form = await request.formData(); } catch { return null; }
  const images = form.getAll("images").filter(isUploadedFile);
  const prompt = typeof form.get("promptOverride") === "string" ? String(form.get("promptOverride")).trim() : "";
  const size = typeof form.get("size") === "string" ? String(form.get("size")) : "";
  if (images.length < 1 || images.length > MAX_IMAGES || !SIZES.has(size) || Buffer.byteLength(prompt, "utf8") > 4_000 || images.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_IMAGE_BYTES || images.some((file) => file.size < 1 || file.size > MAX_IMAGE_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) return null;
  if (!(await Promise.all(images.map(isImageContent))).every(Boolean)) return null;
  const body = new FormData(); body.set("workflowKey", workflow.code); body.set("promptOverride", prompt); body.set("size", size); images.forEach((file) => body.append("images", file, file.name));
  return { summary: `${images.length} 张参考图 · ${size}${prompt ? " · 已填写制作要求" : ""}`, body };
}

function isUploadedFile(item: FormDataEntryValue): item is File {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as File;
  return typeof candidate.name === "string" && typeof candidate.type === "string" && typeof candidate.size === "number" && typeof candidate.slice === "function" && typeof candidate.arrayBuffer === "function";
}

async function isImageContent(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

async function invoke(workflow: ExternalWorkflowDefinition, body: BodyInit, token: string, fetchExternal: ExternalFetch) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30_000);
  const headers = new Headers({ Authorization: `Bearer ${token}`, "X-QuantXY-Workflow": workflow.code, Accept: "application/json" });
  if (workflow.provider === "content-workbench") headers.set("Content-Type", "application/json");
  const url = workflow.provider === "image-studio"
    ? "https://studio.quantumgalaxy.top/api/image-studio/jobs"
    : `https://content.quantumgalaxy.top/api/integrations/v1/workflows/${encodeURIComponent(workflow.code)}/runs`;
  try { return await fetchExternal(url, { method: "POST", headers, body, signal: controller.signal, redirect: "error" }); }
  finally { clearTimeout(timeout); }
}

async function readLimitedJson(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) throw new Error("response_too_large");
  const text = await response.text(); if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("response_too_large");
  try { return JSON.parse(text) as unknown; } catch { return text ? { message: text.slice(0, 600) } : {}; }
}

function firstIdentifier(value: Record<string, unknown> | null) {
  for (const key of ["runId", "jobId", "taskId", "id"]) { const candidate = value?.[key]; if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 200); }
  return null;
}

async function probeConnection(provider: ExternalWorkflowProvider, token: string | null, fetchExternal: ExternalFetch): Promise<ConnectionStatus> {
  if (!token) return "unconfigured";
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5_000);
  const url = provider === "image-studio"
    ? "https://studio.quantumgalaxy.top/api/image-studio/catalog"
    : "https://content.quantumgalaxy.top/api/integrations/v1/workflows";
  try {
    const response = await fetchExternal(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: controller.signal, redirect: "error" });
    return response.ok ? "ready" : "unverified";
  } catch { return "unverified"; }
  finally { clearTimeout(timeout); }
}
