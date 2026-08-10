import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireWorkspaceSession();

  return <WorkspaceShell session={session}>{children}</WorkspaceShell>;
}
