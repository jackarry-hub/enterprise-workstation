import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
type ModelGenerator = (evidence: Record<string, unknown>) => Promise<unknown>;

export type SchedulingDependencies = {
  loadSession: () => Promise<WorkspaceSession | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  serviceRpc?: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  generateModel?: ModelGenerator;
  createRequestId?: () => string;
};

type EvidenceMember = { memberId: number; employeeId: string; name: string; skills: string[]; openTaskCount: number; allocationPercent: number; taskIds: string[] };
type PlanAssignment = { ordinal: number; memberId: number; title: string; description: string; acceptanceCriteria: string; dueDate: string; priority: "low" | "medium" | "high" | "urgent"; estimatedHours: number | null; requiredSkills: string[]; evidence: Record<string, unknown> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function cleanStrings(value: unknown, limit = 20) { return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, limit) : []; }

async function parseBody(request: Request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 65_536) return null;
  try { return record(JSON.parse(raw)); } catch { return null; }
}

function errorStatus(error: { code?: string } | null) { return error?.code === "42501" ? 403 : error?.code === "P0002" ? 404 : error?.code === "23505" || error?.code === "40001" ? 409 : error?.code === "22023" ? 422 : 503; }

async function defaults(): Promise<SchedulingDependencies> {
  const client = await getSupabaseServerClient();
  return { loadSession: getWorkspaceSession, rpc: async (name, args) => await client.rpc(name, args) as RpcResult, serviceRpc: async (name, args) => await getSupabaseServiceRoleClient().rpc(name, args) as RpcResult };
}

export async function handleSchedulingGoals(request: Request, provided?: SchedulingDependencies) {
  const deps = provided ?? await defaults();
  const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const value = await parseBody(request);
  const projectId = typeof value?.projectId === "string" ? value.projectId : "";
  const objective = typeof value?.objective === "string" ? value.objective.trim() : "";
  const constraints = record(value?.constraints) ?? {};
  const key = request.headers.get("idempotency-key")?.toLowerCase();
  if (!UUID_PATTERN.test(projectId) || !objective || objective.length > 1000 || !key || !UUID_PATTERN.test(key)) return json({ error: "invalid_request" }, 400);
  const requestId = deps.createRequestId?.() ?? randomUUID();
  const result = await deps.rpc("create_scheduling_goal", { p_project_public_id: projectId, p_objective: objective, p_constraints: constraints, p_idempotency_key: key, p_request_id: requestId });
  if (result.error) return json({ error: errorStatus(result.error) === 403 ? "forbidden" : errorStatus(result.error) === 404 ? "not_found" : errorStatus(result.error) === 409 ? "conflict" : "scheduling_unavailable", requestId }, errorStatus(result.error));
  return json({ ...record(result.data), requestId }, 201);
}

function evidenceMembers(evidence: Record<string, unknown>) {
  const items = Array.isArray(evidence.members) ? evidence.members : [];
  return items.flatMap((item): EvidenceMember[] => {
    const member = record(item); const memberId = Number(member?.memberId);
    if (!member || !Number.isSafeInteger(memberId) || memberId < 1) return [];
    return [{ memberId, employeeId: String(member.employeeId ?? ""), name: String(member.name ?? ""), skills: cleanStrings(member.skills), openTaskCount: Math.max(0, Number(member.openTaskCount ?? 0)), allocationPercent: Math.max(0, Number(member.allocationPercent ?? 0)), taskIds: cleanStrings(member.taskIds, 100).filter((id) => UUID_PATTERN.test(id)) }];
  });
}

function assignmentEvidence(member: EvidenceMember) {
  return { memberId: member.memberId, employeeId: member.employeeId, taskIds: member.taskIds, skills: member.skills, openTaskCount: member.openTaskCount, allocationPercent: member.allocationPercent };
}

function parseModelPlan(value: unknown, evidence: Record<string, unknown>, members: EvidenceMember[]): PlanAssignment[] | null {
  const output = record(value); const items = Array.isArray(output?.assignments) ? output.assignments : null;
  const project = record(evidence.project); const dueDate = String(project?.dueDate ?? "");
  if (!items?.length || items.length > 20 || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const byId = new Map(members.map((member) => [member.memberId, member]));
  const parsed: PlanAssignment[] = [];
  for (const [ordinal, raw] of items.entries()) {
    const item = record(raw); const memberId = Number(item?.memberId); const member = byId.get(memberId);
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    const acceptance = typeof item?.acceptanceCriteria === "string" ? item.acceptanceCriteria.trim() : "";
    const itemDueDate = typeof item?.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? item.dueDate : dueDate;
    const priority = ["low", "medium", "high", "urgent"].includes(String(item?.priority)) ? item?.priority as PlanAssignment["priority"] : "medium";
    if (!member || !title || title.length > 240 || !acceptance || acceptance.length > 2000 || itemDueDate > dueDate) return null;
    const hours = item?.estimatedHours == null ? null : Number(item.estimatedHours);
    if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 10000)) return null;
    parsed.push({ ordinal, memberId, title, description: typeof item?.description === "string" ? item.description.slice(0, 4000) : "", acceptanceCriteria: acceptance, dueDate: itemDueDate, priority, estimatedHours: hours, requiredSkills: cleanStrings(item?.requiredSkills), evidence: assignmentEvidence(member) });
  }
  return parsed;
}

function rulesPlan(evidence: Record<string, unknown>, members: EvidenceMember[]) {
  const goal = record(evidence.goal); const project = record(evidence.project);
  const constraints = record(goal?.constraints);
  const workItems = cleanStrings(constraints?.workItems).length ? cleanStrings(constraints?.workItems) : [String(goal?.objective ?? "执行目标")];
  const ordered = [...members].sort((a, b) => (a.openTaskCount / Math.max(a.allocationPercent, 1)) - (b.openTaskCount / Math.max(b.allocationPercent, 1)) || a.memberId - b.memberId);
  const dueDate = String(project?.dueDate ?? "");
  return workItems.slice(0, 20).map((title, ordinal): PlanAssignment => {
    const member = ordered[ordinal % ordered.length];
    return { ordinal, memberId: member.memberId, title: title.slice(0, 240), description: `按目标“${String(goal?.objective ?? "").slice(0, 200)}”执行并提交可验收成果。`, acceptanceCriteria: "提交可核验成果、执行记录及风险说明，并由项目负责人验收。", dueDate, priority: "medium", estimatedHours: null, requiredSkills: [], evidence: assignmentEvidence(member) };
  });
}

export async function handleSchedulingPlans(request: Request, goalId: string, provided?: SchedulingDependencies) {
  if (!UUID_PATTERN.test(goalId)) return json({ error: "not_found" }, 404);
  const deps = provided ?? await defaults(); const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const key = request.headers.get("idempotency-key")?.toLowerCase();
  if (!key || !UUID_PATTERN.test(key)) return json({ error: "invalid_idempotency_key" }, 400);
  const evidenceResult = await deps.rpc("get_scheduling_evidence", { p_goal_public_id: goalId });
  const evidence = record(evidenceResult.data);
  if (evidenceResult.error || !evidence) return json({ error: errorStatus(evidenceResult.error) === 404 ? "not_found" : "scheduling_unavailable" }, errorStatus(evidenceResult.error));
  const members = evidenceMembers(evidence);
  if (!members.length) return json({ error: "no_eligible_members" }, 409);
  let source: "model" | "rules" = "rules"; let assignments: PlanAssignment[] | null = null;
  if (deps.generateModel) {
    try { assignments = parseModelPlan(await deps.generateModel(evidence), evidence, members); if (assignments) source = "model"; } catch { assignments = null; }
  }
  assignments ??= rulesPlan(evidence, members);
  const serviceRpc = deps.serviceRpc;
  if (!serviceRpc) return json({ error: "scheduling_unavailable" }, 503);
  const result = await serviceRpc("save_scheduling_plan", {
    p_tenant_public_id: session.tenantId, p_organization_public_id: session.organization.id, p_actor_member_id: session.member.id, p_auth_user_id: session.authUserId,
    p_goal_public_id: goalId, p_source: source, p_assignments: assignments,
    p_summary: { assignmentCount: assignments.length, source, costConfigured: false }, p_cost_amount: null, p_cost_currency: null, p_cost_basis: null,
    p_risk_summary: source === "rules" ? "模型不可用或输出未通过验证，当前为规则方案，派发前必须人工确认。" : "派发前必须人工确认成员、期限和验收标准。",
    p_model_code: source === "model" ? "deepseek-chat" : null, p_request_id: key,
  });
  if (result.error) return json({ error: errorStatus(result.error) === 403 ? "forbidden" : errorStatus(result.error) === 409 ? "conflict" : "scheduling_unavailable" }, errorStatus(result.error));
  return json(record(result.data), 201);
}

export const schedulingInternals = { parseModelPlan, rulesPlan, evidenceMembers };
