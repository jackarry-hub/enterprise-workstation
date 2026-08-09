"use client";

import { useCallback, useEffect, useState } from "react";

import { createInitialOperationsState, OPERATIONS_CHANGED_EVENT, readOperationsState } from "@/features/operations/operations-data";
import { PROJECTS_CHANGED_EVENT } from "@/features/projects/data/mock-project-repository";

export function useOperations() {
  const [state, setState] = useState(createInitialOperationsState);
  const refresh = useCallback(() => setState(readOperationsState()), []);

  useEffect(() => {
    refresh();
    window.addEventListener(OPERATIONS_CHANGED_EVENT, refresh);
    window.addEventListener(PROJECTS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(OPERATIONS_CHANGED_EVENT, refresh);
      window.removeEventListener(PROJECTS_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  return { state, refresh };
}
