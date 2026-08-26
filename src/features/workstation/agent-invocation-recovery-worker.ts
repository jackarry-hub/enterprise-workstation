import { createClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "@/lib/supabase/env";

type RecoveryRpcClient = {
  rpc: (name: string, args?: Record<string, never>) => PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
};

export type ScheduledAgentInvocationRecovery = {
  lockAcquired: boolean;
  recoveredInvocations: number;
};

function isRecoveryResult(value: unknown): value is { lock_acquired: boolean; recovered_invocations: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.lock_acquired === "boolean"
    && Number.isSafeInteger(row.recovered_invocations)
    && Number(row.recovered_invocations) >= 0;
}

export function createScheduledAgentInvocationRecovery(client: unknown) {
  const supabase = client as RecoveryRpcClient;
  return async function recoverScheduledAgentInvocations(): Promise<ScheduledAgentInvocationRecovery> {
    const result = await supabase.rpc("run_agent_invocation_recovery");
    const row = Array.isArray(result.data) ? result.data[0] : null;
    if (result.error || !isRecoveryResult(row)) {
      throw new Error("agent_recovery_failed");
    }
    return {
      lockAcquired: row.lock_acquired,
      recoveredInvocations: row.recovered_invocations,
    };
  };
}

function createRecoveryAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("agent_recovery_unavailable");
  try {
    const { url } = getSupabaseEnv();
    return createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    throw new Error("agent_recovery_unavailable");
  }
}

export async function runScheduledAgentInvocationRecovery() {
  return createScheduledAgentInvocationRecovery(createRecoveryAdminClient())();
}
