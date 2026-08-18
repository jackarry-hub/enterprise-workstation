import { NextResponse } from "next/server";

import { getOAuthStartUrl } from "@/features/auth/oauth-start";
import { getSafeReturnPath, isPublicAuthPath } from "@/features/auth/workspace-access";

export type OAuthStartDependencies = {
  getLoginUrl: (returnPath: string | null) => Promise<string | null>;
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
      const oauthUrl = await dependencies.getLoginUrl(returnPath);
      if (oauthUrl) return NextResponse.redirect(oauthUrl);
    } catch {
      // Keep the employee-facing failure stable and free of provider details.
    }
    return NextResponse.redirect(
      new URL("/access-pending?reason=auth_error", requestUrl),
    );
  };
}
