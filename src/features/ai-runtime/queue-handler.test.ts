import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAiQueueStore, processNextAiQueueJob } from "@/features/ai-runtime/queue-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const jobId = "11111111-1111-4111-8111-111111111111";
const leaseToken = "22222222-2222-4222-8222-222222222222";

afterEach(() => vi.useRealTimers());

describe("governed AI queue", () => {
  it("defines budget, concurrency, lease recovery, cancellation, retry, dead-letter, takeover and retention controls", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202608300010_ai_queue_governance.sql"), "utf8").toLowerCase();
    for (const marker of ["ai_runtime_budgets", "concurrency_limit", "for update skip locked", "cancel_ai_runtime_job", "retry_ai_runtime_job", "dead_letter", "ai_human_takeover_queue", "retention_until", "purge_expired_ai_runtime_records"]) expect(sql).toContain(marker);
    expect(sql).toContain("budget.consumed_tokens+budget.reserved_tokens+coalesce(p_estimated_tokens,0)>budget.token_limit");
    expect(sql).toContain("ai_runtime_budget_reservations");
    expect(sql).toContain("ai_runtime_queue_commands");
  });

  it("enqueues with immutable server scope and explicit estimates", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { jobId, status: "queued" }, error: null });
    const store = createAiQueueStore({ rpc }, executiveWorkspaceSession);
    await store.enqueue({ requestId: "33333333-3333-4333-8333-333333333333", operation: "assistant.reply", payload: { conversationId: "c1" }, estimatedTokens: 800, estimatedCost: null });
    expect(rpc).toHaveBeenCalledWith("enqueue_ai_runtime_job", expect.objectContaining({
      p_tenant_public_id: executiveWorkspaceSession.tenantId,
      p_actor_member_id: executiveWorkspaceSession.member.id,
      p_estimated_tokens: 800,
      p_estimated_cost: null,
    }));
  });

  it("returns cleanly when there is no claimable job", async () => {
    const serviceRpc = vi.fn().mockResolvedValue({ data: { acquired: false }, error: null });
    await expect(processNextAiQueueJob({ serviceRpc, executors: {} })).resolves.toEqual({ acquired: false });
  });

  it("runs a claimed operation and durably completes usage", async () => {
    const serviceRpc = vi.fn()
      .mockResolvedValueOnce({ data: { acquired: true, jobId, leaseToken, operation: "assistant.reply", payload: { text: "hi" }, attempt: 1, timeoutSeconds: 30, modelFallbacks: ["fallback"] }, error: null })
      .mockResolvedValueOnce({ data: { jobId, status: "succeeded", retryScheduled: false }, error: null });
    const executor = vi.fn().mockResolvedValue({ success: true, result: { messageId: "m1" }, consumedTokens: 42, consumedCost: 0.01 });
    await expect(processNextAiQueueJob({ serviceRpc, executors: { "assistant.reply": executor } })).resolves.toMatchObject({ acquired: true, status: "succeeded" });
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ modelFallbacks: ["fallback"], attempt: 1 }));
    expect(serviceRpc).toHaveBeenLastCalledWith("complete_ai_runtime_queue_job", expect.objectContaining({ p_outcome: "succeeded", p_consumed_tokens: 42, p_consumed_cost: 0.01 }));
  });

  it("aborts at the durable timeout and schedules bounded retry", async () => {
    vi.useFakeTimers();
    const serviceRpc = vi.fn()
      .mockResolvedValueOnce({ data: { acquired: true, jobId, leaseToken, operation: "assistant.reply", payload: {}, attempt: 2, timeoutSeconds: 10, modelFallbacks: [] }, error: null })
      .mockResolvedValueOnce({ data: { jobId, status: "queued", retryScheduled: true }, error: null });
    const pending = processNextAiQueueJob({ serviceRpc, executors: { "assistant.reply": async ({ signal }) => await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) } });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toMatchObject({ status: "queued", retryScheduled: true });
    expect(serviceRpc).toHaveBeenLastCalledWith("complete_ai_runtime_queue_job", expect.objectContaining({ p_outcome: "timed_out", p_error_code: "ai_queue_timeout", p_retry_delay_seconds: 60 }));
  });

  it("routes an unconfigured executor to a terminal failure and human takeover", async () => {
    const serviceRpc = vi.fn()
      .mockResolvedValueOnce({ data: { acquired: true, jobId, leaseToken, operation: "unknown.operation", payload: {}, attempt: 1, timeoutSeconds: 30, modelFallbacks: [] }, error: null })
      .mockResolvedValueOnce({ data: { jobId, status: "failed", retryScheduled: false }, error: null });
    await processNextAiQueueJob({ serviceRpc, executors: {} });
    expect(serviceRpc).toHaveBeenLastCalledWith("complete_ai_runtime_queue_job", expect.objectContaining({ p_error_code: "queue_executor_unconfigured", p_retry_delay_seconds: null }));
  });
});
