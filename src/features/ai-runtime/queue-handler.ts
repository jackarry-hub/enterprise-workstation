import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

type RpcResult = { data: unknown; error: unknown };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
type QueueOutcome = "succeeded" | "failed" | "timed_out";

export type AiQueueExecutionResult = {
  success: boolean;
  result: Record<string, unknown>;
  errorCode?: string;
  consumedTokens?: number;
  consumedCost?: number;
  retryable?: boolean;
};

export type AiQueueExecutor = (input: {
  jobId: string;
  operation: string;
  payload: Record<string, unknown>;
  attempt: number;
  modelFallbacks: string[];
  signal: AbortSignal;
}) => Promise<AiQueueExecutionResult>;

export type AiQueueWorkerDependencies = {
  serviceRpc: Rpc;
  executors: Record<string, AiQueueExecutor | undefined>;
  leaseSeconds?: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finiteNonNegative(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function createAiQueueStore(serviceClient: { rpc: Rpc }, session: WorkspaceSession) {
  const scope = {
    p_tenant_public_id: session.tenantId,
    p_organization_public_id: session.organization.id,
    p_actor_member_id: session.member.id,
    p_auth_user_id: session.authUserId,
  };
  return {
    async enqueue(input: {
      requestId: string;
      operation: string;
      payload: Record<string, unknown>;
      priority?: number;
      maxAttempts?: number;
      scheduledAt?: string;
      timeoutSeconds?: number;
      modelFallbacks?: string[];
      estimatedTokens?: number | null;
      estimatedCost?: number | null;
    }) {
      const result = await serviceClient.rpc("enqueue_ai_runtime_job", {
        ...scope,
        p_request_id: input.requestId,
        p_operation: input.operation,
        p_payload: input.payload,
        p_priority: input.priority ?? 5,
        p_max_attempts: input.maxAttempts ?? 5,
        p_scheduled_at: input.scheduledAt ?? new Date().toISOString(),
        p_timeout_seconds: input.timeoutSeconds ?? 120,
        p_model_fallbacks: input.modelFallbacks ?? [],
        p_estimated_tokens: input.estimatedTokens ?? null,
        p_estimated_cost: input.estimatedCost ?? null,
      });
      const receipt = record(result.data);
      if (result.error || !receipt || !UUID_PATTERN.test(String(receipt.jobId ?? ""))) throw new Error("ai_queue_enqueue_failed");
      return receipt;
    },
    async cancel(jobId: string, requestId: string) {
      const result = await serviceClient.rpc("cancel_ai_runtime_job", { ...scope, p_job_public_id: jobId, p_request_id: requestId });
      const receipt = record(result.data);
      if (result.error || !receipt) throw new Error("ai_queue_cancel_failed");
      return receipt;
    },
    async retry(jobId: string, requestId: string) {
      const result = await serviceClient.rpc("retry_ai_runtime_job", { ...scope, p_job_public_id: jobId, p_request_id: requestId });
      const receipt = record(result.data);
      if (result.error || !receipt) throw new Error("ai_queue_retry_failed");
      return receipt;
    },
  };
}

export async function processNextAiQueueJob(dependencies: AiQueueWorkerDependencies) {
  const claimed = await dependencies.serviceRpc("claim_ai_runtime_queue_job", { p_lease_seconds: dependencies.leaseSeconds ?? 120 });
  const job = record(claimed.data);
  if (claimed.error || !job) throw new Error("ai_queue_claim_failed");
  if (job.acquired !== true) return { acquired: false as const };
  const jobId = String(job.jobId ?? "");
  const leaseToken = String(job.leaseToken ?? "");
  const operation = String(job.operation ?? "");
  const payload = record(job.payload);
  const attempt = Number(job.attempt);
  const timeoutSeconds = Number(job.timeoutSeconds);
  const modelFallbacks = Array.isArray(job.modelFallbacks) && job.modelFallbacks.every((item) => typeof item === "string") ? job.modelFallbacks as string[] : [];
  if (!UUID_PATTERN.test(jobId) || !UUID_PATTERN.test(leaseToken) || !operation || !payload || !Number.isSafeInteger(attempt) || attempt < 1 || !Number.isFinite(timeoutSeconds) || timeoutSeconds < 10) throw new Error("ai_queue_invalid_claim");

  const executor = dependencies.executors[operation];
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let execution: AiQueueExecutionResult;
  let outcome: QueueOutcome;
  try {
    if (!executor) {
      execution = { success: false, result: {}, errorCode: "queue_executor_unconfigured", retryable: false };
    } else {
      execution = await Promise.race([
        executor({ jobId, operation, payload, attempt, modelFallbacks, signal: controller.signal }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("ai_queue_timeout")); }, timeoutSeconds * 1000); }),
      ]);
    }
    outcome = execution.success ? "succeeded" : "failed";
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "ai_queue_timeout";
    execution = { success: false, result: {}, errorCode: timedOut ? "ai_queue_timeout" : "queue_executor_failed", retryable: true };
    outcome = timedOut ? "timed_out" : "failed";
  } finally {
    if (timer) clearTimeout(timer);
  }
  const retryDelay = execution.success || execution.retryable === false ? null : Math.min(3600, 30 * (2 ** Math.min(attempt - 1, 7)));
  const completed = await dependencies.serviceRpc("complete_ai_runtime_queue_job", {
    p_job_public_id: jobId,
    p_lease_token: leaseToken,
    p_outcome: outcome,
    p_result: record(execution.result) ?? {},
    p_error_code: execution.errorCode ?? "",
    p_consumed_tokens: Math.trunc(finiteNonNegative(execution.consumedTokens)),
    p_consumed_cost: finiteNonNegative(execution.consumedCost),
    p_retry_delay_seconds: retryDelay,
  });
  const receipt = record(completed.data);
  if (completed.error || !receipt) throw new Error("ai_queue_completion_failed");
  return { acquired: true as const, jobId, ...receipt };
}
