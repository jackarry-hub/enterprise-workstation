"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { createOperationFixtureContextForIdentity } from "@/features/operations/operation-actor-compat";
import { createInitialOperationsState, OPERATIONS_CHANGED_EVENT, readOperationsState } from "@/features/operations/operations-data";
import { PROJECTS_CHANGED_EVENT } from "@/features/projects/data/mock-project-repository";

export function useOperationFixtureContext(session: WorkspaceSession) {
  const context = useMemo(() => createOperationFixtureContextForIdentity({
    tenantId: session.tenantId,
    authUserId: session.authUserId,
    memberId: String(session.member.id),
    primaryRole: session.primaryRole,
    actor: {
      id: session.actor.id,
      memberId: session.actor.memberId,
      name: session.actor.name,
      role: session.actor.role,
      roleLabel: session.actor.roleLabel,
      department: session.actor.department,
      title: session.actor.title,
      landingPath: session.actor.landingPath,
    },
  }),
    [
      session.actor.department,
      session.actor.id,
      session.actor.landingPath,
      session.actor.memberId,
      session.actor.name,
      session.actor.role,
      session.actor.roleLabel,
      session.actor.title,
      session.authUserId,
      session.member.id,
      session.primaryRole,
      session.tenantId,
    ],
  );
  return context;
}

export function useOperations(session: WorkspaceSession) {
  const context = useOperationFixtureContext(session);
  const [state, setState] = useState(() => createInitialOperationsState(context));
  const refresh = useCallback(
    () => setState(readOperationsState(context)),
    [context],
  );

  useEffect(() => {
    refresh();
    window.addEventListener(OPERATIONS_CHANGED_EVENT, refresh);
    window.addEventListener(PROJECTS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(OPERATIONS_CHANGED_EVENT, refresh);
      window.removeEventListener(PROJECTS_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  return {
    state,
    refresh,
    context,
    actor: context.actor ?? session.actor,
    isFixtureBound: context.actor !== null,
  };
}
