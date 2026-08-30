import { describe, expect, it, vi } from "vitest";

import {
  createDistributedRateLimiter,
  getRateLimitEnvironment,
  trustedClientIp,
} from "@/features/security/distributed-rate-limit";

const pepper = "p".repeat(48);
const request = {
  tenantKey: "tenant-test",
  subjectKey: "anonymous-login",
  ipKey: "203.0.113.10",
  action: "auth.login",
  windowSeconds: 60,
  limit: 2,
  lockoutSeconds: 120,
};

function durableRpc() {
  const buckets = new Map<string, number>();
  const receipts = new Map<string, unknown>();
  return vi.fn(async (_name: string, params: Record<string, unknown>) => {
    const requestId = String(params.p_request_id);
    if (receipts.has(requestId)) return { data: receipts.get(requestId), error: null };
    const key = [params.p_tenant_scope_hash, params.p_subject_scope_hash, params.p_ip_scope_hash, params.p_action].join(":");
    const next = (buckets.get(key) ?? 0) + 1;
    buckets.set(key, next);
    const limit = Number(params.p_limit_count);
    const data = {
      allowed: next <= limit,
      remaining: Math.max(0, limit - next),
      resetAt: "2026-08-30T12:01:00.000Z",
      retryAfter: next <= limit ? 0 : 120,
      lockedUntil: next <= limit ? null : "2026-08-30T12:02:00.000Z",
    };
    receipts.set(requestId, data);
    return { data, error: null };
  });
}

describe("distributed rate limiter", () => {
  it("persists a shared limit across independently created server instances", async () => {
    const rpc = durableRpc();
    const firstInstance = createDistributedRateLimiter({ rpc }, pepper);
    const secondInstance = createDistributedRateLimiter({ rpc }, pepper);
    expect(await firstInstance.consume({ ...request, requestId: crypto.randomUUID() })).toMatchObject({ allowed: true, remaining: 1 });
    expect(await secondInstance.consume({ ...request, requestId: crypto.randomUUID() })).toMatchObject({ allowed: true, remaining: 0 });
    expect(await createDistributedRateLimiter({ rpc }, pepper).consume({ ...request, requestId: crypto.randomUUID() })).toMatchObject({ allowed: false, retryAfter: 120 });
  });

  it("hashes tenant, subject and IP independently before the RPC boundary", async () => {
    const rpc = durableRpc();
    const limiter = createDistributedRateLimiter({ rpc }, pepper);
    await limiter.consume({ ...request, requestId: crypto.randomUUID() });
    const params = rpc.mock.calls[0]?.[1] as Record<string, string>;
    expect(params.p_tenant_scope_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(params.p_subject_scope_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(params.p_ip_scope_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([params.p_tenant_scope_hash, params.p_subject_scope_hash, params.p_ip_scope_hash]).size).toBe(3);
    expect(JSON.stringify(params)).not.toContain(request.ipKey);
    expect(JSON.stringify(params)).not.toContain(request.tenantKey);
  });

  it("replays the same request id and isolates a different tenant, user or IP", async () => {
    const rpc = durableRpc();
    const limiter = createDistributedRateLimiter({ rpc }, pepper);
    const requestId = crypto.randomUUID();
    const first = await limiter.consume({ ...request, requestId });
    expect(await limiter.consume({ ...request, requestId })).toEqual(first);
    expect(await limiter.consume({ ...request, tenantKey: "tenant-other", requestId: crypto.randomUUID() })).toMatchObject({ allowed: true });
    expect(await limiter.consume({ ...request, subjectKey: "user-other", requestId: crypto.randomUUID() })).toMatchObject({ allowed: true });
    expect(await limiter.consume({ ...request, ipKey: "203.0.113.11", requestId: crypto.randomUUID() })).toMatchObject({ allowed: true });
  });

  it("fails closed on malformed database responses or missing security configuration", async () => {
    const limiter = createDistributedRateLimiter({ rpc: vi.fn().mockResolvedValue({ data: { allowed: true }, error: null }) }, pepper);
    await expect(limiter.consume(request)).rejects.toThrow("rate_limit_unavailable");
    expect(() => getRateLimitEnvironment({})).toThrow("rate_limit_configuration_missing");
  });

  it("accepts only an explicitly trusted single-value proxy IP header", () => {
    const request = new Request("https://work.quantxy.test", { headers: { "x-real-ip": "203.0.113.12" } });
    expect(trustedClientIp(request, "x-real-ip")).toBe("203.0.113.12");
    expect(trustedClientIp(new Request("https://work.quantxy.test", { headers: { "x-real-ip": "1.1.1.1, 2.2.2.2" } }), "x-real-ip")).toBe("unavailable");
  });
});
