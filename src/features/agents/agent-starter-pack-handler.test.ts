import { describe, expect, it, vi } from "vitest";

import { handleAgentStarterPack } from "@/features/agents/agent-starter-pack-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const requestId = "11111111-1111-4111-8111-111111111111";

describe("Agent starter pack", () => {
  it("provisions the reviewed pack through the authenticated RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "ready", installed: 3, available: 3 }, error: null });
    const response = await handleAgentStarterPack(new Request("https://q.test/api/workstation/agents/starter-pack", {
      method: "POST",
      headers: { "idempotency-key": requestId },
    }), { loadSession: async () => ({ ...executiveWorkspaceSession, permissionCodes: ["agent.manage"] }), rpc });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ installed: 3, available: 3, requestId });
    expect(rpc).toHaveBeenCalledWith("provision_current_agent_starter_pack", { p_request_id: requestId });
  });

  it("blocks members without agent.manage before the database", async () => {
    const rpc = vi.fn();
    const response = await handleAgentStarterPack(new Request("https://q.test", { method: "POST", headers: { "idempotency-key": requestId } }), {
      loadSession: async () => executiveWorkspaceSession,
      rpc,
    });
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
