import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { assertServerRouteAccess } from "@/features/auth/server-route-access";

export function canRoleAccessPath(session: WorkspaceSession, pathname: string) {
  try {
    assertServerRouteAccess(session, pathname);
    return true;
  } catch {
    return false;
  }
}
