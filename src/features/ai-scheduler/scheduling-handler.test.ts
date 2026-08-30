import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { handleSchedulingPlans, schedulingInternals, type SchedulingDependencies } from "@/features/ai-scheduler/scheduling-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const goalId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const taskId = "33333333-3333-4333-8333-333333333333";
const evidence = { goal: { id: goalId, objective: "完成上线", constraints: {} }, project: { id: key, name: "企业站", dueDate: "2026-09-10" }, members: [{ memberId: 8, employeeId: key, name: "成员", skills: ["nextjs"], allocationPercent: 100, openTaskCount: 2, taskIds: [taskId] }] };

function dependencies(generateModel?: SchedulingDependencies["generateModel"]) {
  const rpc = vi.fn().mockResolvedValue({ data: evidence, error: null });
  const serviceRpc = vi.fn().mockImplementation(async (_name, args) => ({ data: { plan: { id: key, source: args.p_source, cost: args.p_cost_amount, assignments: args.p_assignments } }, error: null }));
  return { value: { loadSession: async () => executiveWorkspaceSession, rpc: rpc as unknown as SchedulingDependencies["rpc"], serviceRpc: serviceRpc as unknown as SchedulingDependencies["serviceRpc"], generateModel } satisfies SchedulingDependencies, serviceRpc };
}

describe("explainable AI scheduling", () => {
  it("stores immutable versions, source labels, nullable cost and entity evidence", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202608300007_ai_scheduling.sql"), "utf8").toLowerCase();
    expect(sql).toContain("source in ('model','rules')");
    expect(sql).toContain("cost_amount numeric(14,6)");
    expect(sql).toContain("scheduling_plan_immutable");
    expect(sql).toContain("taskids");
  });

  it("accepts a validated model plan but replaces its evidence with authorized database IDs", async () => {
    const { value, serviceRpc } = dependencies(async () => ({ assignments: [{ memberId: 8, title: "发布", acceptanceCriteria: "健康检查通过", dueDate: "2026-09-09", priority: "high", requiredSkills: ["nextjs"], evidence: { taskIds: ["spoofed"] } }] }));
    const response = await handleSchedulingPlans(new Request("https://test/api", { method: "POST", headers: { "Idempotency-Key": key } }), goalId, value);
    expect(response.status).toBe(201);
    expect(serviceRpc).toHaveBeenCalledWith("save_scheduling_plan", expect.objectContaining({ p_source: "model", p_cost_amount: null, p_assignments: [expect.objectContaining({ evidence: expect.objectContaining({ taskIds: [taskId] }) })] }));
  });

  it("labels deterministic fallback as rules and never fabricates zero cost", async () => {
    const { value, serviceRpc } = dependencies(async () => ({ assignments: [] }));
    await handleSchedulingPlans(new Request("https://test/api", { method: "POST", headers: { "Idempotency-Key": key } }), goalId, value);
    expect(serviceRpc).toHaveBeenCalledWith("save_scheduling_plan", expect.objectContaining({ p_source: "rules", p_cost_amount: null, p_cost_basis: null }));
  });

  it("rejects model assignments to members outside the real evidence set", () => {
    expect(schedulingInternals.parseModelPlan({ assignments: [{ memberId: 999, title: "越权", acceptanceCriteria: "完成", dueDate: "2026-09-09" }] }, evidence, schedulingInternals.evidenceMembers(evidence))).toBeNull();
  });
});
