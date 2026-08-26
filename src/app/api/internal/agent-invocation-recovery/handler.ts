import { createHash, timingSafeEqual } from "node:crypto";

import {
  runScheduledAgentInvocationRecovery,
  type ScheduledAgentInvocationRecovery,
} from "@/features/workstation/agent-invocation-recovery-worker";

export type AgentInvocationRecoveryDependencies = {
  cronSecret: string | null;
  recover: () => Promise<ScheduledAgentInvocationRecovery>;
};

function configuredSecret(value: string | null): value is string {
  return typeof value === "string"
    && value.length >= 32
    && value.length <= 512
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeAuthorizationMatches(authorization: string | null, secret: string) {
  const actualDigest = createHash("sha256").update(authorization ?? "", "utf8").digest();
  const expectedDigest = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function json(value: unknown, status: number) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function createAgentInvocationRecoveryHandler(dependencies: AgentInvocationRecoveryDependencies) {
  return async function recoverAgentInvocations(request: Request) {
    if (!configuredSecret(dependencies.cronSecret)) {
      return json({ error: "agent_recovery_unavailable" }, 503);
    }
    if (!safeAuthorizationMatches(request.headers.get("authorization"), dependencies.cronSecret)) {
      return json({ error: "unauthorized" }, 401);
    }
    try {
      const result = await dependencies.recover();
      return json({
        status: result.lockAcquired ? "completed" : "already_running",
        recoveredInvocations: result.recoveredInvocations,
      }, 200);
    } catch {
      return json({ error: "agent_recovery_failed" }, 502);
    }
  };
}

export const defaultAgentInvocationRecoveryDependencies: AgentInvocationRecoveryDependencies = {
  cronSecret: process.env.AGENT_INVOCATION_RECOVERY_CRON_SECRET ?? null,
  recover: runScheduledAgentInvocationRecovery,
};
