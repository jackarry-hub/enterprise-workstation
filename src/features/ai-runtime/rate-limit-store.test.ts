import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createAiRuntimeStore } from "@/features/ai-runtime/rate-limit-store";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("shared AI runtime store", () => {
  it("uses one database receipt and locked shared window instead of process memory", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202608300005_ai_runtime_limits.sql"), "utf8").toLowerCase();
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("for update");
    expect(sql).toContain("ai_rate_limit_receipts");
    expect(sql).toContain("rate_limited");
  });

  it("passes immutable session scope to the shared limiter", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { allowed: false, remaining: 0, resetAt: "2026-08-30T10:01:00Z" }, error: null });
    const result = await createAiRuntimeStore({ rpc }, executiveWorkspaceSession).consume("assistant.chat", "11111111-1111-4111-8111-111111111111");
    expect(result.allowed).toBe(false);
    expect(rpc).toHaveBeenCalledWith("consume_ai_rate_limit", expect.objectContaining({
      p_tenant_public_id: executiveWorkspaceSession.tenantId,
      p_actor_member_id: executiveWorkspaceSession.member.id,
      p_limit_count: 30,
    }));
  });

  it("normalizes provider authentication failures in the durable ledger", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { invocationId: "22222222-2222-4222-8222-222222222222", status: "failed" }, error: null });
    await createAiRuntimeStore({ rpc }, executiveWorkspaceSession).finalize(
      "22222222-2222-4222-8222-222222222222", "failed", { inputTokens: 0, outputTokens: 0 }, "upstream_auth_failed", "2026-08-30T10:01:00Z",
    );
    expect(rpc).toHaveBeenCalledWith("finalize_ai_runtime_invocation", expect.objectContaining({ p_error_code: "ai_provider_unauthorized", p_cost_amount: null }));
  });
});
