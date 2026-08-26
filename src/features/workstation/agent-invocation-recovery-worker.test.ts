// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createScheduledAgentInvocationRecovery } from "@/features/workstation/agent-invocation-recovery-worker";

describe("scheduled Agent invocation recovery worker", () => {
  it("uses only the no-scope service RPC and returns its locked recovery result", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ lock_acquired: true, recovered_invocations: 3 }],
      error: null,
    }));

    const result = await createScheduledAgentInvocationRecovery({ rpc } as never)();

    expect(result).toEqual({ lockAcquired: true, recoveredInvocations: 3 });
    expect(rpc).toHaveBeenCalledWith("run_agent_invocation_recovery");
  });

  it("fails closed when the service RPC response is malformed", async () => {
    const recover = createScheduledAgentInvocationRecovery({
      rpc: async () => ({ data: [{ lock_acquired: true, recovered_invocations: -1 }], error: null }),
    } as never);

    await expect(recover()).rejects.toThrow("agent_recovery_failed");
  });
});
