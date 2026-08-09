"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { demoActors, OPERATIONS_ACTOR_CHANGED_EVENT, OPERATIONS_ACTOR_KEY } from "@/features/operations/operations-data";
import type { DemoActor } from "@/features/operations/operations-types";

type DemoSessionValue = {
  actor: DemoActor;
  actors: readonly DemoActor[];
  ready: boolean;
  setActorId: (actorId: string) => DemoActor;
};

const fallbackSession: DemoSessionValue = {
  actor: demoActors[0],
  actors: demoActors,
  ready: false,
  setActorId(actorId) { return demoActors.find(({ id }) => id === actorId) ?? demoActors[0]; },
};

const DemoSessionContext = createContext<DemoSessionValue>(fallbackSession);

export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<DemoActor>(demoActors[0]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const actorId = window.localStorage.getItem(OPERATIONS_ACTOR_KEY);
    setActor(demoActors.find(({ id }) => id === actorId) ?? demoActors[0]);
    setReady(true);
  }, []);

  const value = useMemo<DemoSessionValue>(() => ({
    actor,
    actors: demoActors,
    ready,
    setActorId(actorId) {
      const next = demoActors.find(({ id }) => id === actorId) ?? demoActors[0];
      window.localStorage.setItem(OPERATIONS_ACTOR_KEY, next.id);
      setActor(next);
      window.dispatchEvent(new CustomEvent(OPERATIONS_ACTOR_CHANGED_EVENT, { detail: next.id }));
      return next;
    },
  }), [actor, ready]);

  return <DemoSessionContext.Provider value={value}>{children}</DemoSessionContext.Provider>;
}

export function useDemoSession() {
  return useContext(DemoSessionContext);
}
