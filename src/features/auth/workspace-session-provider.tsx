"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

const WorkspaceSessionContext = createContext<WorkspaceSession | null>(null);

export function WorkspaceSessionProvider({
  session,
  children,
}: {
  session: WorkspaceSession;
  children: ReactNode;
}) {
  return (
    <WorkspaceSessionContext.Provider value={session}>
      {children}
    </WorkspaceSessionContext.Provider>
  );
}

export function useWorkspaceSession() {
  const session = useContext(WorkspaceSessionContext);
  if (!session) throw new Error("WorkspaceSessionProvider 缺失");
  return session;
}
