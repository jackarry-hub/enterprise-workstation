import { NextResponse, type NextRequest } from "next/server";

import {
  FORMAL_WORKSTATION_PATH,
  getSafeReturnPath,
  getWorkspaceAccessFailureReason,
  isPublicAuthPath,
  parseWorkspaceAccess,
} from "@/features/auth/workspace-access";
import { canRoleAccessPath } from "@/features/operations/role-access";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

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
  if (isStandaloneAuthorizedPath(pathname)) return NextResponse.next();

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

  if (!canRoleAccessPath(session.primaryRole, pathname)) {
    const destination = new URL(FORMAL_WORKSTATION_PATH, request.url);
    destination.searchParams.set("notice", "no_access");
    return redirectWithRefreshedCookies(response, destination);
  }

  return response;
}

export function isStandaloneAuthorizedPath(pathname: string) {
  return pathname === "/workstation-server-adapter.js"
    || pathname === "/api/workstation/bootstrap"
    || pathname === "/api/workstation/directory-sync"
    || pathname === "/api/workstation/projects"
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
    || pathname === "/api/ai/chat";
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico$|brand/|api/auth/feishu/userinfo$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
