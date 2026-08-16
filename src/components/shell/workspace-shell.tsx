import { Suspense, type ReactNode } from "react";

import { WorkspaceAccessNotice } from "@/components/shell/workspace-access-notice";
import { WorkspaceHeader } from "@/components/shell/workspace-header";
import { RoleAccessGuard } from "@/components/shell/role-access-guard";
import { WorkspaceSidebar } from "@/components/shell/workspace-sidebar";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { MobileAppFrame } from "@/features/mobile-workstation/components/mobile-app-frame";

type WorkspaceShellProps = {
  children: ReactNode;
  session: WorkspaceSession;
  demoSessions?: readonly WorkspaceSession[];
};

export function WorkspaceShell({ children, session, demoSessions }: WorkspaceShellProps) {
  return (
    <WorkspaceSessionProvider session={session} demoSessions={demoSessions}>
      <RoleAccessGuard>
        <div className="mobile-workspace-stage workspace-mesh min-h-screen">
          <div className="fixed inset-y-0 left-0 z-50 hidden md:block">
            <WorkspaceSidebar />
          </div>

          <div className="min-h-screen md:pl-56">
            <div className="hidden md:block">
              <WorkspaceHeader />
            </div>

            <MobileAppFrame>
              <div id="main-content">
                <Suspense fallback={null}>
                  <WorkspaceAccessNotice />
                </Suspense>
                {children}
              </div>
            </MobileAppFrame>
          </div>
        </div>
      </RoleAccessGuard>
    </WorkspaceSessionProvider>
  );
}
