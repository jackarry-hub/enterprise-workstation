"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

const WorkspaceSessionContext = createContext<WorkspaceSession | null>(null);

export const CUSTOMER_DEMO_ACTOR_KEY = "enterprise-workstation.customer-demo.actor.v1";

type CustomerDemoSessionControls = {
  enabled: boolean;
  sessions: readonly WorkspaceSession[];
  currentPersonId: string | null;
  switchIdentity: (personId: string) => WorkspaceSession | null;
};

const CustomerDemoSessionContext = createContext<CustomerDemoSessionControls>({
  enabled: false,
  sessions: [],
  currentPersonId: null,
  switchIdentity: () => null,
});

function personIdFromSession(session: WorkspaceSession) {
  const prefix = "customer-demo:";
  return session.identity.providerSubject.startsWith(prefix)
    ? session.identity.providerSubject.slice(prefix.length)
    : null;
}

export function WorkspaceSessionProvider({
  session,
  demoSessions,
  children,
}: {
  session: WorkspaceSession;
  demoSessions?: readonly WorkspaceSession[];
  children: ReactNode;
}) {
  const availableSessions = useMemo(
    () => demoSessions?.length ? demoSessions : [],
    [demoSessions],
  );
  const [currentSession, setCurrentSession] = useState(session);

  useEffect(() => {
    if (!availableSessions.length) {
      setCurrentSession(session);
      return;
    }
    const storedPersonId = window.localStorage.getItem(CUSTOMER_DEMO_ACTOR_KEY);
    const storedSession = availableSessions.find(
      (candidate) => personIdFromSession(candidate) === storedPersonId,
    );
    if (storedPersonId && !storedSession) {
      window.localStorage.removeItem(CUSTOMER_DEMO_ACTOR_KEY);
    }
    setCurrentSession(storedSession ?? session);
  }, [availableSessions, session]);

  const switchIdentity = useCallback((personId: string) => {
    const nextSession = availableSessions.find(
      (candidate) => personIdFromSession(candidate) === personId,
    );
    if (!nextSession) return null;
    window.localStorage.setItem(CUSTOMER_DEMO_ACTOR_KEY, personId);
    setCurrentSession(nextSession);
    return nextSession;
  }, [availableSessions]);

  const controls = useMemo<CustomerDemoSessionControls>(() => ({
    enabled: availableSessions.length > 0,
    sessions: availableSessions,
    currentPersonId: personIdFromSession(currentSession),
    switchIdentity,
  }), [availableSessions, currentSession, switchIdentity]);

  return (
    <WorkspaceSessionContext.Provider value={currentSession}>
      <CustomerDemoSessionContext.Provider value={controls}>
        {children}
      </CustomerDemoSessionContext.Provider>
    </WorkspaceSessionContext.Provider>
  );
}

export function useWorkspaceSession() {
  const session = useContext(WorkspaceSessionContext);
  if (!session) throw new Error("WorkspaceSessionProvider 缺失");
  return session;
}

export function useCustomerDemoSession() {
  return useContext(CustomerDemoSessionContext);
}
