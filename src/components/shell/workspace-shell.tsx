import type { ReactNode } from "react";

import { WorkspaceHeader } from "@/components/shell/workspace-header";
import { RoleAccessGuard } from "@/components/shell/role-access-guard";
import { WorkspaceSidebar } from "@/components/shell/workspace-sidebar";
import { DemoSessionProvider } from "@/features/operations/demo-session";

type WorkspaceShellProps = {
  children: ReactNode;
};

export function WorkspaceShell({ children }: WorkspaceShellProps) {
  return (
    <DemoSessionProvider>
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
    </DemoSessionProvider>
  );
}
