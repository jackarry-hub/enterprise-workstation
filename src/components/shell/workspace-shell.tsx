import type { ReactNode } from "react";

import { WorkspaceHeader } from "@/components/shell/workspace-header";
import { RoleAccessGuard } from "@/components/shell/role-access-guard";
import { WorkspaceSidebar } from "@/components/shell/workspace-sidebar";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

type WorkspaceShellProps = {
  children: ReactNode;
  session: WorkspaceSession;
};

export function WorkspaceShell({ children, session }: WorkspaceShellProps) {
  return (
    <WorkspaceSessionProvider session={session}>
      <RoleAccessGuard>
        <div className="workspace-mesh min-h-screen">
          <div className="fixed inset-y-0 left-0 z-50 hidden lg:block">
            <WorkspaceSidebar />
          </div>
          <div className="min-h-screen lg:pl-56">
            <WorkspaceHeader />
            <div id="main-content">{children}</div>
          </div>
        </div>
      </RoleAccessGuard>
    </WorkspaceSessionProvider>
  );
}
