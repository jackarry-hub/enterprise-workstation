import { describe, expect, it, vi } from "vitest";

import { dispatchHighRiskTool } from "@/features/ai-runtime/high-risk-tool-dispatcher";
import { hashHighRiskPayload } from "@/features/ai-runtime/human-confirmation";
import { HIGH_RISK_ACTIONS } from "@/features/ai-runtime/tool-adapter";
import { createExportDataAdapter } from "@/features/ai-runtime/tools/export-data";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const confirmationId = "22222222-2222-4222-8222-222222222222";
const executionToken = "33333333-3333-4333-8333-333333333333";
const executionId = "44444444-4444-4444-8444-444444444444";
const resourceId = "55555555-5555-4555-8555-555555555555";
const payload = { format: "csv", scope: "customers" };

function input(overrides: Partial<Parameters<typeof dispatchHighRiskTool>[0]> = {}): Parameters<typeof dispatchHighRiskTool>[0] {
  return {
    tenantId: executiveWorkspaceSession.tenantId,
    organizationId: executiveWorkspaceSession.organization.id,
    actorId: executiveWorkspaceSession.member.id,
    authUserId: executiveWorkspaceSession.authUserId,
    resourceId,
    action: "export_data",
    payload,
    payloadHash: hashHighRiskPayload(payload),
    confirmationId,
    ...overrides,
  };
}

describe("central high-risk tool dispatcher", () => {
  it.each(HIGH_RISK_ACTIONS)("rejects %s before any adapter call when confirmation is absent", async (action) => {
    const serviceRpc = vi.fn();
    const result = await dispatchHighRiskTool(input({ action, confirmationId: undefined }), { serviceRpc, adapters: {} });
    expect(result.code).toBe("human_confirmation_required");
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it.each(["human_confirmation_replayed", "human_confirmation_expired", "human_confirmation_mismatch"])("propagates the bound confirmation failure %s", async (code) => {
    const serviceRpc = vi.fn().mockResolvedValue({ data: { claimed: false, code }, error: null });
    const execute = vi.fn();
    const adapter = createExportDataAdapter(execute);
    expect(await dispatchHighRiskTool(input(), { serviceRpc, adapters: { export_data: adapter } })).toMatchObject({ success: false, code });
    expect(execute).not.toHaveBeenCalled();
  });

  it("claims once, passes the confirmation as downstream idempotency key, and completes the audit", async () => {
    const serviceRpc = vi.fn()
      .mockResolvedValueOnce({ data: { claimed: true, executionToken, executionId }, error: null })
      .mockResolvedValueOnce({ data: { executionId, outcome: "succeeded" }, error: null });
    const execute = vi.fn().mockResolvedValue({ success: true, safeSummary: { exportId: "exp_1" } });
    const result = await dispatchHighRiskTool(input(), { serviceRpc, adapters: { export_data: createExportDataAdapter(execute) } });
    expect(result).toMatchObject({ success: true, code: "succeeded", executionId });
    expect(execute).toHaveBeenCalledWith(payload, expect.objectContaining({ idempotencyKey: confirmationId, executionId }));
    expect(serviceRpc).toHaveBeenLastCalledWith("complete_ai_high_risk_execution", expect.objectContaining({ p_success: true, p_confirmation_public_id: confirmationId }));
  });

  it("records adapter failure instead of inventing success", async () => {
    const serviceRpc = vi.fn()
      .mockResolvedValueOnce({ data: { claimed: true, executionToken, executionId }, error: null })
      .mockResolvedValueOnce({ data: { executionId, outcome: "failed" }, error: null });
    const adapter = createExportDataAdapter(async () => { throw new Error("provider down"); });
    const result = await dispatchHighRiskTool(input(), { serviceRpc, adapters: { export_data: adapter } });
    expect(result).toMatchObject({ success: false, code: "tool_execution_failed" });
    expect(serviceRpc).toHaveBeenLastCalledWith("complete_ai_high_risk_execution", expect.objectContaining({ p_success: false, p_error_code: "tool_execution_failed" }));
  });

  it("does not consume a confirmation for an unconfigured real adapter", async () => {
    const serviceRpc = vi.fn();
    expect(await dispatchHighRiskTool(input(), { serviceRpc, adapters: {} })).toMatchObject({ code: "tool_adapter_unconfigured" });
    expect(serviceRpc).not.toHaveBeenCalled();
  });
});
