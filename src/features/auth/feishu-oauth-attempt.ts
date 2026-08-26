import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { getSafeReturnPath, isPublicAuthPath } from "@/features/auth/workspace-access";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const FEISHU_OAUTH_NONCE_COOKIE = "qx_feishu_oauth_nonce";
const ATTEMPT_MAX_AGE_SECONDS = 600;

export type FeishuOAuthAttempt = {
  attemptId: string;
  nonce: string;
  returnPath: string | null;
  maxAge: number;
};

export type FeishuOAuthAttemptRepository = {
  create: (input: {
    attemptId: string;
    nonceDigest: string;
    returnPath: string | null;
    expiresAt: string;
  }) => Promise<void>;
  consume: (input: {
    attemptId: string;
    nonceDigest: string;
  }) => Promise<boolean | { valid: boolean; returnPath: string | null }>;
};

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeReturnPath(value: string | null | undefined) {
  const safe = getSafeReturnPath(value);
  if (!safe) return null;
  return isPublicAuthPath(new URL(safe, "https://oauth.local").pathname) ? null : safe;
}

function adminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("oauth_attempt_unavailable");
  return createClient(getSupabaseEnv().url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const defaultFeishuOAuthAttemptRepository: FeishuOAuthAttemptRepository = {
  async create(input) {
    const { error } = await adminClient().rpc("create_feishu_oauth_attempt", {
      p_attempt_id: input.attemptId,
      p_nonce_digest: input.nonceDigest,
      p_return_path: input.returnPath,
      p_expires_at: input.expiresAt,
    });
    if (error) throw new Error("oauth_attempt_unavailable");
  },
  async consume(input) {
    const { data, error } = await adminClient().rpc("consume_feishu_oauth_attempt", {
      p_attempt_id: input.attemptId,
      p_nonce_digest: input.nonceDigest,
    });
    if (error || !data || typeof data !== "object") return false;
    const row = data as Record<string, unknown>;
    return {
      valid: row.valid === true,
      returnPath: safeReturnPath(typeof row.returnPath === "string" ? row.returnPath : null),
    };
  },
};

export async function createFeishuOAuthAttempt(
  returnPath?: string | null,
  repository: FeishuOAuthAttemptRepository = defaultFeishuOAuthAttemptRepository,
): Promise<FeishuOAuthAttempt> {
  const attemptId = randomUUID();
  const nonce = randomBytes(32).toString("base64url");
  const validatedReturnPath = safeReturnPath(returnPath);
  await repository.create({
    attemptId,
    nonceDigest: digest(nonce),
    returnPath: validatedReturnPath,
    expiresAt: new Date(Date.now() + ATTEMPT_MAX_AGE_SECONDS * 1_000).toISOString(),
  });
  return { attemptId, nonce, returnPath: validatedReturnPath, maxAge: ATTEMPT_MAX_AGE_SECONDS };
}

export async function consumeFeishuOAuthAttemptResult(
  attemptId: string,
  nonce: string,
  repository: FeishuOAuthAttemptRepository = defaultFeishuOAuthAttemptRepository,
) {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId) || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
    return { valid: false, returnPath: null as string | null };
  }
  const result = await repository.consume({ attemptId, nonceDigest: digest(nonce) });
  if (typeof result === "boolean") return { valid: result, returnPath: null };
  return { valid: result.valid, returnPath: safeReturnPath(result.returnPath) };
}

export async function consumeFeishuOAuthAttempt(
  attemptId: string,
  nonce: string,
  repository: FeishuOAuthAttemptRepository = defaultFeishuOAuthAttemptRepository,
) {
  return (await consumeFeishuOAuthAttemptResult(attemptId, nonce, repository)).valid;
}

export function readFeishuOAuthNonceCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === FEISHU_OAUTH_NONCE_COOKIE) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}
