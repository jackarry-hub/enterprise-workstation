import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { isCustomerDemoMode } from "@/features/demo/customer-demo-mode";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const demoMode = isCustomerDemoMode();
  const session = demoMode
    ? customerDemoSessions[0]
    : await requireWorkspaceSession();

  return (
    <WorkspaceShell
      session={session}
      demoSessions={demoMode ? customerDemoSessions : undefined}
    >
      {children}
    </WorkspaceShell>
  );
}
