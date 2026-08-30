import { describe, expect, it, vi } from "vitest";

import { handleHumanConfirmation, hashHighRiskPayload, requireHumanConfirmation } from "@/features/ai-runtime/human-confirmation";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const runId = "11111111-1111-4111-8111-111111111111";
const confirmationId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";

describe("AI human confirmation", () => {
  it("hashes canonical object content independently of key order", () => {
    expect(hashHighRiskPayload({ amount: 9, account: "A" })).toBe(hashHighRiskPayload({ account: "A", amount: 9 }));
  });

  it("binds a fresh confirmation to run, action, payload and idempotency key", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { confirmationId, state: "confirmed" }, error: null });
    const result = await requireHumanConfirmation({ resourceId: runId, action: "create_payment_record", payload: { amount: 900 }, idempotencyKey: requestId }, rpc);
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rpc).toHaveBeenCalledWith("confirm_current_ai_action", expect.objectContaining({
      p_resource_id: runId,
      p_action: "create_payment_record",
      p_request_id: requestId,
      p_ttl_seconds: 120,
    }));
  });

  it("uses the URL run identity and server-computed payload hash", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { confirmationId, state: "confirmed" }, error: null });
    const response = await handleHumanConfirmation(new Request(`https://quantxy.test/api/workstation/ai/runs/${runId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": requestId },
      body: JSON.stringify({ action: "export_data", payload: { format: "csv", scope: "customers" } }),
    }), runId, { loadSession: async () => executiveWorkspaceSession, rpc });
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("confirm_current_ai_action", expect.objectContaining({ p_action: "export_data", p_resource_id: runId, p_payload_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }));
  });

  it("fails closed for anonymous and malformed protected actions", async () => {
    const request = new Request(`https://quantxy.test/api/workstation/ai/runs/${runId}/confirm`, { method: "POST", body: "{}" });
    expect((await handleHumanConfirmation(request.clone(), runId, { loadSession: async () => null, rpc: vi.fn() })).status).toBe(401);
    expect((await handleHumanConfirmation(request, runId, { loadSession: async () => executiveWorkspaceSession, rpc: vi.fn() })).status).toBe(400);
  });
});
