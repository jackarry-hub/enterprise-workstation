import { createHmac, randomUUID } from "node:crypto";

type RpcClient = {
  rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
};

export type DistributedRateLimitRequest = {
  tenantKey: string;
  subjectKey: string;
  ipKey: string;
  action: string;
  windowSeconds: number;
  limit: number;
  lockoutSeconds: number;
  requestId?: string;
};

export type DistributedRateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  retryAfter: number;
  lockedUntil: string | null;
};

type RateLimitEnvironment = Readonly<Record<string, string | undefined>>;

const SAFE_IP_HEADERS = new Set(["x-real-ip", "cf-connecting-ip"]);
const SAFE_SCOPE = /^[a-zA-Z0-9:@._-]{1,180}$/;
const SAFE_ACTION = /^[a-z][a-z0-9_.-]{1,79}$/;

function safeInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum;
}

function parseResult(value: unknown): DistributedRateLimitResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.allowed !== "boolean"
    || !safeInteger(source.remaining, 0, 10_000)
    || !safeInteger(source.retryAfter, 0, 604_800)
    || typeof source.resetAt !== "string"
    || !Number.isFinite(Date.parse(source.resetAt))
    || (source.lockedUntil !== null
      && (typeof source.lockedUntil !== "string" || !Number.isFinite(Date.parse(source.lockedUntil))))
  ) return null;
  return {
    allowed: source.allowed,
    remaining: source.remaining as number,
    resetAt: source.resetAt,
    retryAfter: source.retryAfter as number,
    lockedUntil: source.lockedUntil as string | null,
  };
}

function hashScope(pepper: string, domain: string, value: string) {
  return createHmac("sha256", pepper).update(`${domain}:${value}`, "utf8").digest("hex");
}

export function getRateLimitEnvironment(env: RateLimitEnvironment = process.env) {
  const pepper = env.RATE_LIMIT_HASH_PEPPER?.trim();
  const tenantKey = env.FEISHU_TENANT_KEY?.trim();
  const trustedIpHeader = env.RATE_LIMIT_TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (!pepper || pepper.length < 32 || pepper.length > 512) {
    throw new Error("rate_limit_configuration_missing");
  }
  if (!tenantKey || !SAFE_SCOPE.test(tenantKey)) {
    throw new Error("rate_limit_configuration_missing");
  }
  if (!trustedIpHeader || !SAFE_IP_HEADERS.has(trustedIpHeader)) {
    throw new Error("rate_limit_configuration_missing");
  }
  return { pepper, tenantKey, trustedIpHeader };
}

export function trustedClientIp(request: Request, trustedHeader: string) {
  if (!SAFE_IP_HEADERS.has(trustedHeader)) throw new Error("rate_limit_configuration_missing");
  const value = request.headers.get(trustedHeader)?.trim();
  if (!value || value.length > 64 || /[\s,\u0000-\u001f\u007f]/.test(value)) return "unavailable";
  return value.toLowerCase();
}

export function createDistributedRateLimiter(client: RpcClient, pepper: string) {
  if (pepper.length < 32 || pepper.length > 512) {
    throw new Error("rate_limit_configuration_missing");
  }
  return {
    async consume(request: DistributedRateLimitRequest): Promise<DistributedRateLimitResult> {
      if (
        !SAFE_SCOPE.test(request.tenantKey)
        || !SAFE_SCOPE.test(request.subjectKey)
        || request.ipKey.length < 1
        || request.ipKey.length > 180
        || !SAFE_ACTION.test(request.action)
        || !safeInteger(request.windowSeconds, 1, 86_400)
        || !safeInteger(request.limit, 1, 10_000)
        || !safeInteger(request.lockoutSeconds, 1, 604_800)
      ) throw new Error("rate_limit_request_invalid");
      const result = await client.rpc("consume_distributed_rate_limit", {
        p_tenant_scope_hash: hashScope(pepper, "tenant", request.tenantKey),
        p_subject_scope_hash: hashScope(pepper, "subject", request.subjectKey),
        p_ip_scope_hash: hashScope(pepper, "ip", request.ipKey),
        p_action: request.action,
        p_window_seconds: request.windowSeconds,
        p_limit_count: request.limit,
        p_lockout_seconds: request.lockoutSeconds,
        p_request_id: request.requestId ?? randomUUID(),
      });
      const parsed = result.error ? null : parseResult(result.data);
      if (!parsed) throw new Error("rate_limit_unavailable");
      return parsed;
    },
  };
}
