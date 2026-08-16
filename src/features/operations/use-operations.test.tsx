import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import * as operationsData from "@/features/operations/operations-data";
import { useOperations } from "@/features/operations/use-operations";
import { PROJECTS_CHANGED_EVENT } from "@/features/projects/data/mock-project-repository";

const session = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-executive",
)!;
const context = createOperationFixtureContext(session);

describe("useOperations synchronization", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("refreshes operations when the storage key changes in another tab", async () => {
    const readSpy = vi.spyOn(operationsData, "readOperationsState");
    renderHook(() => useOperations(session));
    await waitFor(() => expect(readSpy).toHaveBeenCalled());
    readSpy.mockClear();

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: operationsData.getOperationsStorageKey(context),
      }));
    });

    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated storage keys", async () => {
    const readSpy = vi.spyOn(operationsData, "readOperationsState");
    renderHook(() => useOperations(session));
    await waitFor(() => expect(readSpy).toHaveBeenCalled());
    readSpy.mockClear();

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    });

    expect(readSpy).not.toHaveBeenCalled();
  });

  it("notifies project consumers only when workstreams or tasks change", () => {
    const projectListener = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, projectListener);
    const initial = operationsData.createInitialOperationsState(context);
    operationsData.saveOperationsState(context, initial);
    projectListener.mockClear();

    operationsData.saveOperationsState(context, {
      ...initial,
      notificationReads: { "actor-executive": ["notification-1"] },
    });
    expect(projectListener).not.toHaveBeenCalled();

    operationsData.saveOperationsState(context, {
      ...initial,
      tasks: initial.tasks.map((task, index) => index === 0
        ? { ...task, progress: 50 }
        : task),
    });
    expect(projectListener).toHaveBeenCalledTimes(1);
    window.removeEventListener(PROJECTS_CHANGED_EVENT, projectListener);
  });
});
