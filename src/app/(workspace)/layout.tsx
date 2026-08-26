import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import {
  assertServerRouteAccess,
  WORKSPACE_PATH_HEADER,
} from "@/features/auth/server-route-access";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireWorkspaceSession();
  const pathname = (await headers()).get(WORKSPACE_PATH_HEADER);

  try {
    if (!pathname) throw new Error("route_forbidden");
    assertServerRouteAccess(session, pathname);
  } catch {
    redirect(session.landingPath);
  }

  return <WorkspaceShell session={session}>{children}</WorkspaceShell>;
}
