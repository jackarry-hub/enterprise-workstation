import { NextResponse, type NextRequest } from "next/server";

import {
  getSafeReturnPath,
  getWorkspaceAccessFailureReason,
  isPublicAuthPath,
  parseWorkspaceAccess,
} from "@/features/auth/workspace-access";
import {
  assertServerRouteAccess,
  resolveNoAccessFallbackPath,
  WORKSPACE_PATH_HEADER,
} from "@/features/auth/server-route-access";
import {
  isLocalPreviewHost,
  isServerPreviewEnabled,
} from "@/lib/runtime/workstation-mode";
import { updateSupabaseSession } from "@/lib/supabase/middleware";
import {
  requiresBrowserMutationOrigin,
  validateMutationOrigin,
} from "@/features/security/csrf-origin";

function redirectWithRefreshedCookies(
  response: NextResponse,
  destination: URL,
) {
  const redirect = NextResponse.redirect(destination);
  response.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie);
  });
  return redirect;
}

function continueWithTrustedWorkspacePath(
  response: NextResponse,
  request: NextRequest,
  pathname: string,
) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(WORKSPACE_PATH_HEADER);
  requestHeaders.set(WORKSPACE_PATH_HEADER, pathname);

  const next = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.getAll().forEach((cookie) => {
    next.cookies.set(cookie);
  });
  return next;
}

function loginDestination(request: NextRequest) {
  const destination = new URL("/login", request.url);
  const returnPath = getSafeReturnPath(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  if (returnPath) destination.searchParams.set("next", returnPath);
  return destination;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (requiresBrowserMutationOrigin(pathname)) {
    const origin = validateMutationOrigin(request);
    if (!origin.allowed) {
      return NextResponse.json(
        { error: "cross_origin_request_rejected" },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
  }
  if (
    isStandaloneAuthorizedPath(pathname)
    || isLocalPreviewWorkstationPath(request.nextUrl)
  ) {
    return NextResponse.next();
  }

  const localPreviewRedirect = getLocalPreviewAccessPendingRedirect(
    request.nextUrl,
  );
  if (localPreviewRedirect) {
    return NextResponse.redirect(localPreviewRedirect);
  }

  const { response, supabase, subject } = await updateSupabaseSession(request);

  if (isPublicAuthPath(pathname)) return response;
  if (!subject) {
    return redirectWithRefreshedCookies(response, loginDestination(request));
  }

  let data: unknown = null;
  let error: unknown = null;
  try {
    const result = await supabase.rpc("current_workspace_access");
    data = result.data;
    error = result.error;
  } catch {
    error = true;
  }

  let claimedReason: string | null = null;
  if ((data === null || data === undefined) && !error) {
    try {
      const claim = await supabase.rpc("claim_current_identity");
      if (!claim.error && typeof claim.data === "string") {
        claimedReason = claim.data;
      }
    } catch {
      claimedReason = null;
    }
  }

  const failureReason = getWorkspaceAccessFailureReason(data, error, subject);
  const session = failureReason ? null : parseWorkspaceAccess(data);
  if (!session || session.authUserId !== subject) {
    const reason = claimedReason === "not_provisioned"
      || claimedReason === "suspended"
      || claimedReason === "departed"
      || claimedReason === "revoked"
      ? claimedReason
      : failureReason ?? "misconfigured";
    return redirectWithRefreshedCookies(
      response,
      new URL(`/access-pending?reason=${reason}`, request.url),
    );
  }

  try {
    assertServerRouteAccess(session, pathname);
  } catch {
    const destination = noAccessDestination(session, request.url);
    return redirectWithRefreshedCookies(response, destination);
  }

  return continueWithTrustedWorkspacePath(response, request, pathname);
}

export function isStandaloneAuthorizedPath(pathname: string) {
  return pathname === "/api/health/ready"
    || pathname === "/workstation-server-adapter.js"
    || pathname === "/api/workstation/bootstrap"
    || pathname === "/api/workstation/directory-sync"
    || pathname === "/api/workstation/approvals"
    || pathname.startsWith("/api/workstation/approvals/")
    || pathname === "/api/workstation/expenses"
    || pathname.startsWith("/api/workstation/expenses/")
    || pathname === "/api/workstation/projects"
    || pathname.startsWith("/api/workstation/projects/")
    || pathname.startsWith("/api/workstation/notifications/")
    || pathname.startsWith("/api/workstation/files/")
    || pathname.startsWith("/api/workstation/knowledge/")
    || pathname.startsWith("/api/workstation/ai/")
    || pathname.startsWith("/api/workstation/scheduling/")
    || pathname === "/api/workstation/tasks"
    || pathname.startsWith("/api/workstation/tasks/")
    || pathname === "/api/workstation/payroll"
    || pathname === "/api/workstation/payroll/policy"
    || pathname === "/api/workstation/payroll/preview"
    || pathname === "/api/workstation/work-profile"
    || pathname === "/api/auth/logout"
    || pathname === "/api/demo-auth/login"
    || pathname === "/api/demo-auth/session"
    || pathname === "/api/demo-auth/logout"
    || pathname === "/api/ai/config"
    || pathname === "/api/ai/chat"
    || pathname === "/api/internal/agent-invocation-recovery"
    || pathname === "/api/internal/task-notification-recovery"
    || pathname === "/api/internal/knowledge-processing"
    || pathname === "/api/internal/file-upload-cleanup";
}

function noAccessDestination(session: Parameters<typeof assertServerRouteAccess>[0], requestUrl: string) {
  return new URL(resolveNoAccessFallbackPath(session), requestUrl);
}

export function isLocalPreviewWorkstationPath(url: URL) {
  return url.pathname === "/quantxy-ai-workbench-fused.html"
    && url.searchParams.get("formal") !== "1"
    && isServerPreviewEnabled()
    && isLocalPreviewHost(url.hostname);
}

export function getLocalPreviewAccessPendingRedirect(url: URL) {
  if (
    url.pathname !== "/access-pending"
    || url.searchParams.get("reason") !== "auth_error"
    || !isServerPreviewEnabled()
    || !isLocalPreviewHost(url.hostname)
  ) {
    return null;
  }

  const destination = new URL("/quantxy-ai-workbench-fused.html", url);
  destination.searchParams.set("v", "local-preview");
  return destination;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico$|brand/|api/auth/feishu/userinfo$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
