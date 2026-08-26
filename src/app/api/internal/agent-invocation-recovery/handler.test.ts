// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

async function loadHandler() {
  return import("@/app/api/internal/agent-invocation-recovery/handler");
}

describe("scheduled Agent invocation recovery", () => {
  it("rejects unauthenticated requests before the recovery worker can run", async () => {
    const { createAgentInvocationRecoveryHandler } = await loadHandler();
    const recover = vi.fn(async () => ({ lockAcquired: true, recoveredInvocations: 1 }));
    const handler = createAgentInvocationRecoveryHandler({
      cronSecret: "c".repeat(32),
      recover,
    });

    const response = await handler(new Request("http://localhost/api/internal/agent-invocation-recovery", {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(recover).not.toHaveBeenCalled();
  });

  it("fails closed when scheduling configuration is missing", async () => {
    const { createAgentInvocationRecoveryHandler } = await loadHandler();
    const recover = vi.fn(async () => ({ lockAcquired: true, recoveredInvocations: 1 }));
    const handler = createAgentInvocationRecoveryHandler({ cronSecret: null, recover });

    const response = await handler(new Request("http://localhost/api/internal/agent-invocation-recovery", {
      method: "POST",
      headers: { authorization: "Bearer anything" },
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "agent_recovery_unavailable" });
    expect(recover).not.toHaveBeenCalled();
  });

  it("runs the locked server worker for a valid scheduled request without accepting tenant scope", async () => {
    const { createAgentInvocationRecoveryHandler } = await loadHandler();
    const recover = vi.fn(async () => ({ lockAcquired: true, recoveredInvocations: 2 }));
    const handler = createAgentInvocationRecoveryHandler({
      cronSecret: "c".repeat(32),
      recover,
    });

    const response = await handler(new Request("http://localhost/api/internal/agent-invocation-recovery?tenant=forged", {
      method: "POST",
      headers: { authorization: `Bearer ${"c".repeat(32)}` },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "completed",
      recoveredInvocations: 2,
    });
    expect(recover).toHaveBeenCalledWith();
  });

  it("returns a safe no-op when the advisory lock is already held so retries cannot double-claim", async () => {
    const { createAgentInvocationRecoveryHandler } = await loadHandler();
    const handler = createAgentInvocationRecoveryHandler({
      cronSecret: "c".repeat(32),
      recover: async () => ({ lockAcquired: false, recoveredInvocations: 0 }),
    });

    const response = await handler(new Request("http://localhost/api/internal/agent-invocation-recovery", {
      method: "POST",
      headers: { authorization: `Bearer ${"c".repeat(32)}` },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "already_running",
      recoveredInvocations: 0,
    });
  });
});
