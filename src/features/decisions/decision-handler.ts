import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
type GeneratePlan = (evidence: Record<string, unknown>) => Promise<unknown>;
export type DecisionDependencies = {
  loadSession: () => Promise<WorkspaceSession | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  serviceRpc?: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  generatePlan?: GeneratePlan;
  createRequestId?: () => string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const priorities = new Set(["low", "medium", "high", "urgent"]);
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function response(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
async function body(request: Request) { const raw = await request.text(); if (Buffer.byteLength(raw, "utf8") > 65_536) return null; try { return record(JSON.parse(raw)); } catch { return null; } }
function status(error: { code?: string } | null) { return error?.code === "42501" ? 403 : error?.code === "P0002" ? 404 : ["23505", "40001", "55000"].includes(error?.code ?? "") ? 409 : error?.code === "22023" ? 422 : 503; }
function errorName(code: number) { return code === 403 ? "forbidden" : code === 404 ? "not_found" : code === 409 ? "conflict" : code === 422 ? "invalid_request" : "decision_unavailable"; }
function key(request: Request) { const value = request.headers.get("idempotency-key")?.toLowerCase() ?? ""; return UUID.test(value) ? value : null; }

async function defaults(): Promise<DecisionDependencies> {
  const client = await getSupabaseServerClient();
  return { loadSession: getWorkspaceSession, rpc: async (name, args) => await client.rpc(name, args) as RpcResult, serviceRpc: async (name, args) => await getSupabaseServiceRoleClient().rpc(name, args) as RpcResult };
}

export async function handleDecisionCollection(request: Request, supplied?: DecisionDependencies) {
  const deps = supplied ?? await defaults(); const session = await deps.loadSession();
  if (!session) return response({ error: "unauthenticated" }, 401);
  if (request.method === "GET") { const result = await deps.rpc("list_current_decision_workbench", { p_limit: 50 }); const code = status(result.error); return result.error ? response({ error: errorName(code) }, code) : response(record(result.data) ?? { commands: [], members: [], departments: [] }); }
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const value = await body(request); const idempotencyKey = key(request);
  const title = typeof value?.title === "string" ? value.title.trim() : ""; const objective = typeof value?.objective === "string" ? value.objective.trim() : "";
  const background = typeof value?.background === "string" ? value.background.trim() : ""; const expectedOutcome = typeof value?.expectedOutcome === "string" ? value.expectedOutcome.trim() : "";
  const deadline = typeof value?.deadline === "string" ? value.deadline : ""; const priority = typeof value?.priority === "string" ? value.priority : ""; const budget = Number(value?.budget ?? 0);
  const constraints = typeof value?.constraints === "string" ? value.constraints.trim() : ""; const assignedMemberId = value?.assignedMemberId == null ? null : Number(value.assignedMemberId); const assignedDepartmentId = value?.assignedDepartmentId == null ? null : Number(value.assignedDepartmentId);
  const attachments = Array.isArray(value?.attachmentIds) ? value.attachmentIds.filter((item): item is string => typeof item === "string" && UUID.test(item)).slice(0, 20) : [];
  if (!idempotencyKey || !title || title.length > 160 || !objective || objective.length > 4000 || !expectedOutcome || expectedOutcome.length > 4000 || !DATE.test(deadline) || !priorities.has(priority) || !Number.isFinite(budget) || budget < 0 || background.length > 12_000 || constraints.length > 4000 || (assignedMemberId !== null && (!Number.isSafeInteger(assignedMemberId) || assignedMemberId < 1)) || (assignedDepartmentId !== null && (!Number.isSafeInteger(assignedDepartmentId) || assignedDepartmentId < 1))) return response({ error: "invalid_request" }, 400);
  const requestId = deps.createRequestId?.() ?? randomUUID(); const result = await deps.rpc("create_current_decision_command", { p_title: title, p_objective: objective, p_background: background, p_expected_outcome: expectedOutcome, p_deadline: deadline, p_priority: priority, p_budget: budget, p_constraints: constraints, p_assigned_member_id: assignedMemberId, p_assigned_department_id: assignedDepartmentId, p_attachment_public_ids: attachments, p_idempotency_key: idempotencyKey, p_request_id: requestId }); const code = status(result.error);
  return result.error ? response({ error: errorName(code), requestId }, code) : response({ ...record(result.data), requestId }, 201);
}

function validPlan(value: unknown) {
  const plan = record(value); const project = record(plan?.project); const milestones = Array.isArray(plan?.milestones) ? plan.milestones : []; const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  if (!plan || typeof plan.understanding !== "string" || !plan.understanding.trim() || typeof plan.executionGoal !== "string" || !plan.executionGoal.trim() || !project || typeof project.name !== "string" || !project.name.trim() || milestones.length < 1 || milestones.length > 20 || tasks.length < 1 || tasks.length > 20) return null;
  const keys = new Set<string>();
  for (const raw of tasks) { const task = record(raw); const taskKey = typeof task?.key === "string" ? task.key.trim() : ""; if (!task || !taskKey || keys.has(taskKey) || typeof task.title !== "string" || !task.title.trim() || typeof task.acceptanceCriteria !== "string" || !task.acceptanceCriteria.trim() || typeof task.dueDate !== "string" || !DATE.test(task.dueDate) || !priorities.has(String(task.priority)) || !Number.isSafeInteger(Number(task.assigneeMemberId)) || Number(task.assigneeMemberId) < 1 || !Array.isArray(task.dependencies)) return null; keys.add(taskKey); }
  return plan;
}

function fallbackPlan(evidence: Record<string, unknown>) {
  const command = record(evidence.command) ?? {}; const members = Array.isArray(evidence.members) ? evidence.members.map(record).filter(Boolean) as Record<string, unknown>[] : [];
  const preferred = Number(command.assignedMemberId); const member = members.find((item) => Number(item.memberId) === preferred) ?? members.find((item) => item.accountStatus === "active") ?? members[0];
  if (!member) return null; const dueDate = String(command.deadline ?? ""); const title = String(command.title ?? "执行指令");
  return { understanding: String(command.objective ?? title), executionGoal: String(command.expectedOutcome ?? command.objective ?? title), project: { name: title, description: String(command.background ?? command.objective ?? "") }, milestones: [{ key: "delivery", name: "完成并验收", description: "提交可核验成果并完成负责人验收", dueDate }], tasks: [{ key: "task-1", milestoneKey: "delivery", title, description: String(command.objective ?? ""), acceptanceCriteria: String(command.expectedOutcome ?? "提交可核验成果并通过负责人验收"), dueDate, priority: priorities.has(String(command.priority)) ? command.priority : "medium", assigneeMemberId: Number(member.memberId), estimatedHours: null, dependencies: [] }], risks: ["规则兜底方案，派发前必须人工确认负责人、截止日期和验收标准。"] };
}

export async function handleDecisionPlan(request: Request, commandId: string, supplied?: DecisionDependencies) {
  if (!UUID.test(commandId)) return response({ error: "not_found" }, 404); const deps = supplied ?? await defaults(); const session = await deps.loadSession(); if (!session) return response({ error: "unauthenticated" }, 401);
  if (request.method === "PATCH") { const value = await body(request); const idempotencyKey = key(request); const plan = validPlan(value?.plan); const expectedVersion = Number(value?.expectedVersion); if (!idempotencyKey || !plan || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return response({ error: "invalid_request" }, 400); const requestId = deps.createRequestId?.() ?? randomUUID(); const result = await deps.rpc("revise_current_decision_plan", { p_command_public_id: commandId, p_plan: plan, p_expected_command_version: expectedVersion, p_idempotency_key: idempotencyKey, p_request_id: requestId }); const code = status(result.error); return result.error ? response({ error: errorName(code), requestId }, code) : response({ ...record(result.data), requestId }); }
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405); const idempotencyKey = key(request); if (!idempotencyKey) return response({ error: "invalid_idempotency_key" }, 400);
  const evidenceResult = await deps.rpc("get_current_decision_evidence", { p_command_public_id: commandId }); const evidence = record(evidenceResult.data); const evidenceCode = status(evidenceResult.error); if (evidenceResult.error || !evidence) return response({ error: errorName(evidenceCode) }, evidenceCode);
  let source: "model" | "manual" = "manual"; let plan: Record<string, unknown> | null = null;
  if (deps.generatePlan) { try { plan = validPlan(await deps.generatePlan(evidence)); if (plan) source = "model"; } catch { plan = null; } }
  plan ??= fallbackPlan(evidence); if (!plan) return response({ error: "no_eligible_members" }, 409); const serviceRpc = deps.serviceRpc; if (!serviceRpc) return response({ error: "decision_unavailable" }, 503);
  const result = await serviceRpc("save_decision_plan_from_service", { p_tenant_public_id: session.tenantId, p_organization_public_id: session.organization.id, p_actor_member_id: session.member.id, p_auth_user_id: session.authUserId, p_command_public_id: commandId, p_plan: plan, p_source: source, p_provider: source === "model" ? "deepseek" : null, p_agent_public_id: null, p_agent_run_public_id: null, p_model_code: source === "model" ? "deepseek-chat" : null, p_token_usage: {}, p_cost_amount: null, p_error_code: source === "manual" ? "model_fallback" : null, p_request_id: idempotencyKey }); const code = status(result.error);
  return result.error ? response({ error: errorName(code) }, code) : response({ ...record(result.data), source }, 201);
}

export async function handleDecisionConfirm(request: Request, commandId: string, supplied?: DecisionDependencies) {
  if (!UUID.test(commandId)) return response({ error: "not_found" }, 404); const deps = supplied ?? await defaults(); const session = await deps.loadSession(); if (!session) return response({ error: "unauthenticated" }, 401); if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const value = await body(request); const expectedVersion = Number(value?.expectedVersion); const idempotencyKey = key(request); if (!idempotencyKey || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return response({ error: "invalid_request" }, 400); const requestId = deps.createRequestId?.() ?? randomUUID(); const result = await deps.rpc("confirm_current_decision_plan", { p_command_public_id: commandId, p_expected_command_version: expectedVersion, p_idempotency_key: idempotencyKey, p_request_id: requestId }); const code = status(result.error); const payload = record(result.data); if (result.error) return response({ error: errorName(code), requestId }, code); if (payload?.outcome === "failure") return response({ ...payload, requestId }, 409); return response({ ...payload, requestId }, 201);
}

export async function handleDecisionComplete(request: Request, commandId: string, supplied?: DecisionDependencies) {
  if (!UUID.test(commandId)) return response({ error: "not_found" }, 404); const deps = supplied ?? await defaults(); const session = await deps.loadSession(); if (!session) return response({ error: "unauthenticated" }, 401); if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const value = await body(request); const expectedVersion = Number(value?.expectedVersion); const summary = typeof value?.summary === "string" ? value.summary.trim() : ""; const idempotencyKey = key(request); if (!idempotencyKey || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !summary || summary.length > 2000) return response({ error: "invalid_request" }, 400); const requestId = deps.createRequestId?.() ?? randomUUID(); const result = await deps.rpc("complete_current_decision_command", { p_command_public_id: commandId, p_expected_command_version: expectedVersion, p_summary: summary, p_idempotency_key: idempotencyKey, p_request_id: requestId }); const code = status(result.error); return result.error ? response({ error: result.error.code === "55000" ? "tasks_incomplete" : errorName(code), requestId }, code) : response({ ...record(result.data), requestId }, 201);
}

export const decisionInternals = { validPlan, fallbackPlan };
