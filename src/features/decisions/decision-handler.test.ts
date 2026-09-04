// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import { decisionInternals, handleDecisionCollection, handleDecisionConfirm } from "./decision-handler";

const id = "11111111-1111-4111-8111-111111111111";
function deps(rpc = vi.fn(async () => ({ data: {}, error: null }))) { return { loadSession: async () => executiveWorkspaceSession, rpc, createRequestId: () => id }; }
describe("decision handler", () => {
  it("requires durable idempotency on command creation", async () => { const result = await handleDecisionCollection(new Request("https://q.test/api", { method: "POST", body: "{}" }), deps()); expect(result.status).toBe(400); });
  it("returns conflict when an atomic confirmation reports no writes", async () => { const result = await handleDecisionConfirm(new Request("https://q.test/api", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": id }, body: JSON.stringify({ expectedVersion: 2 }) }), id, deps(vi.fn(async () => ({ data: { outcome: "failure", error: "command_failed" }, error: null })))); expect(result.status).toBe(409); });
  it("builds a confirmable rules plan only from a real member", () => { const plan = decisionInternals.fallbackPlan({ command: { title: "上线", objective: "完成上线", expectedOutcome: "验收通过", deadline: "2026-09-10", priority: "high" }, members: [{ memberId: 8, accountStatus: "active" }] }); expect(plan?.tasks[0]).toMatchObject({ assigneeMemberId: 8, acceptanceCriteria: "验收通过" }); expect(decisionInternals.validPlan(plan)).not.toBeNull(); });
});
