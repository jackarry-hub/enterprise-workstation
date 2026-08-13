import { Suspense, type ReactNode } from "react";

import { WorkspaceAccessNotice } from "@/components/shell/workspace-access-notice";
import { RoleAccessGuard } from "@/components/shell/role-access-guard";
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
        <div className="mobile-workspace-stage">
          <MobileAppFrame>
            <div id="main-content">
              <Suspense fallback={null}>
                <WorkspaceAccessNotice />
              </Suspense>
              {children}
            </div>
          </MobileAppFrame>
        </div>
      </RoleAccessGuard>
    </WorkspaceSessionProvider>
  );
}
