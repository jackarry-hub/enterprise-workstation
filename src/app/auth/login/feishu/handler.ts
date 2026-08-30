import { NextResponse } from "next/server";

import { getAuthRedirectOrigin } from "@/features/auth/auth-env";
import { getOAuthStartUrl } from "@/features/auth/oauth-start";
import { FEISHU_OAUTH_NONCE_COOKIE } from "@/features/auth/feishu-oauth-attempt";
import {
  createDistributedRateLimiter,
  getRateLimitEnvironment,
  trustedClientIp,
  type DistributedRateLimitResult,
} from "@/features/security/distributed-rate-limit";
import { getSafeReturnPath, isPublicAuthPath } from "@/features/auth/workspace-access";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type OAuthStartDependencies = {
  getLoginUrl: (returnPath: string | null) => Promise<{
    url: string;
    nonce: string;
    maxAge: number;
  } | null>;
  consumeLoginAttempt: (request: Request) => Promise<DistributedRateLimitResult>;
};

export const defaultOAuthStartDependencies: OAuthStartDependencies = {
  getLoginUrl: (returnPath) => getOAuthStartUrl("feishu", returnPath),
  consumeLoginAttempt: async (request) => {
    const environment = getRateLimitEnvironment();
    const limiter = createDistributedRateLimiter(
      getSupabaseServiceRoleClient(),
      environment.pepper,
    );
    return limiter.consume({
      tenantKey: environment.tenantKey,
      subjectKey: "anonymous-oauth-login",
      ipKey: trustedClientIp(request, environment.trustedIpHeader),
      action: "auth.login",
      windowSeconds: 60,
      limit: 10,
      lockoutSeconds: 900,
    });
  },
};

function unavailableResponse(status: 429 | 503, retryAfter?: number) {
  const response = NextResponse.json(
    { error: status === 429 ? "login_rate_limited" : "login_temporarily_unavailable" },
    { status },
  );
  response.headers.set("cache-control", "no-store");
  if (status === 429) response.headers.set("retry-after", String(Math.max(1, retryAfter ?? 60)));
  return response;
}

export function createOAuthStartHandler(dependencies: OAuthStartDependencies) {
  return async function startOAuth(request: Request) {
    const requestUrl = new URL(request.url);
    let limit: DistributedRateLimitResult;
    try {
      limit = await dependencies.consumeLoginAttempt(request);
    } catch {
      return unavailableResponse(503);
    }
    if (!limit.allowed) return unavailableResponse(429, limit.retryAfter);
    const safeNext = getSafeReturnPath(requestUrl.searchParams.get("next"));
    const returnPath = safeNext
      && !isPublicAuthPath(new URL(safeNext, requestUrl.origin).pathname)
      && new URL(safeNext, requestUrl.origin).pathname !== "/quantxy-ai-workbench-fused.html"
      ? safeNext
      : null;
    try {
      const oauth = await dependencies.getLoginUrl(returnPath);
      if (oauth) {
        const response = NextResponse.redirect(oauth.url);
        response.headers.set("cache-control", "no-store");
        response.cookies.set(FEISHU_OAUTH_NONCE_COOKIE, oauth.nonce, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/auth/callback",
          maxAge: oauth.maxAge,
        });
        return response;
      }
    } catch {
      // Keep the employee-facing failure stable and free of provider details.
    }
    const response = NextResponse.redirect(
      new URL(
        "/access-pending?reason=auth_error",
        getAuthRedirectOrigin(requestUrl),
      ),
    );
    response.headers.set("cache-control", "no-store");
    return response;
  };
}
