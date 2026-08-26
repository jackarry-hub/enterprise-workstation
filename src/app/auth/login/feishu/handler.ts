import { NextResponse } from "next/server";

import { getAuthRedirectOrigin } from "@/features/auth/auth-env";
import { getOAuthStartUrl } from "@/features/auth/oauth-start";
import { FEISHU_OAUTH_NONCE_COOKIE } from "@/features/auth/feishu-oauth-attempt";
import { getSafeReturnPath, isPublicAuthPath } from "@/features/auth/workspace-access";

export type OAuthStartDependencies = {
  getLoginUrl: (returnPath: string | null) => Promise<{
    url: string;
    nonce: string;
    maxAge: number;
  } | null>;
};

export const defaultOAuthStartDependencies: OAuthStartDependencies = {
  getLoginUrl: (returnPath) => getOAuthStartUrl("feishu", returnPath),
};

export function createOAuthStartHandler(dependencies: OAuthStartDependencies) {
  return async function startOAuth(request: Request) {
    const requestUrl = new URL(request.url);
    const safeNext = getSafeReturnPath(requestUrl.searchParams.get("next"));
    const returnPath = safeNext
      && !isPublicAuthPath(new URL(safeNext, requestUrl.origin).pathname)
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
