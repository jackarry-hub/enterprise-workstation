import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import {
  getCommercialModuleForPath,
  hasModuleCapability,
} from "@/features/commercial/module-capabilities";

export const WORKSPACE_PATH_HEADER = "x-quantxy-workspace-path";

const sharedWorkspacePaths = new Set(["/"]);

export function assertServerRouteAccess(
  session: WorkspaceSession,
  pathname: string,
): void {
  if (sharedWorkspacePaths.has(pathname)) return;

  const commercialModule = getCommercialModuleForPath(pathname);
  if (!commercialModule || !hasModuleCapability(session, commercialModule)) {
    throw new Error("route_forbidden");
  }
}

export function resolveNoAccessFallbackPath(session: WorkspaceSession) {
  try {
    assertServerRouteAccess(session, session.landingPath);
    const landing = new URL(session.landingPath, "http://quantxy.local");
    landing.searchParams.set("notice", "no_access");
    return `${landing.pathname}${landing.search}`;
  } catch {
    return "/access-pending?reason=no_access";
  }
}
