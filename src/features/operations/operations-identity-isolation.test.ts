import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  createDefaultDecisionInput,
  readStoredDecision,
  saveStoredDecision,
} from "@/features/decision-workbench/decision-workbench-data";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import {
  createInitialOperationsState,
  getOperationsStorageKey,
  OPERATIONS_STORAGE_KEY,
  readOperationsState,
  saveOperationsState,
  updateOperationTask,
} from "@/features/operations/operations-data";
import { useOperations } from "@/features/operations/use-operations";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

function unboundSession(overrides: Partial<WorkspaceSession> = {}): WorkspaceSession {
  const authUserId = overrides.authUserId
    ?? "10000000-0000-4000-8000-000000000099";
  const member = overrides.member
    ?? { ...executiveWorkspaceSession.member, id: 99 };
  return {
    ...executiveWorkspaceSession,
    ...overrides,
    authUserId,
    member,
    actor: {
      ...executiveWorkspaceSession.actor,
      id: authUserId,
      memberId: String(member.id),
      ...overrides.actor,
    },
  };
}

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

describe("operations fixture identity isolation", () => {
  it.each([
    ["same role, different user", unboundSession()],
    ["same role, different tenant", unboundSession({
      tenantId: "10000000-0000-4000-8000-000000000098",
    })],
  ])("does not read or expose fixture state to an unbound %s", (_label, session) => {
    const context = createOperationFixtureContext(session);
    const browserStorage = storage();
    browserStorage.setItem(OPERATIONS_STORAGE_KEY, JSON.stringify({
      version: 1,
      tasks: [{ id: "leaked-task" }],
      files: [{ id: "leaked-file" }],
    }));
    browserStorage.setItem.mockClear();

    const state = readOperationsState(context, browserStorage);

    expect(state.tasks).toEqual([]);
    expect(state.files).toEqual([]);
    expect(state.supportRequests).toEqual([]);
    expect(browserStorage.getItem).not.toHaveBeenCalled();
    expect(browserStorage.setItem).not.toHaveBeenCalled();
  });

  it("rejects an unbound write before touching browser storage", () => {
    const context = createOperationFixtureContext(unboundSession());
    const browserStorage = storage();

    expect(() => saveOperationsState(
      context,
      createInitialOperationsState(context),
      browserStorage,
    )).toThrow("当前真实身份未绑定本地业务夹具");
    expect(browserStorage.getItem).not.toHaveBeenCalled();
    expect(browserStorage.setItem).not.toHaveBeenCalled();
  });

  it("rejects an unbound business mutation before reading or writing localStorage", () => {
    const context = createOperationFixtureContext(unboundSession());
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    expect(() => updateOperationTask(
      context,
      "flow-task-01",
      { status: "in_progress" },
      "actor-executive",
      executiveWorkspaceSession.actor,
    )).toThrow("当前真实身份未绑定本地业务夹具");
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("uses a tenant/user/member namespaced key for an explicitly bound identity", () => {
    const context = createOperationFixtureContext(executiveWorkspaceSession);
    const browserStorage = storage();

    readOperationsState(context, browserStorage);

    expect(getOperationsStorageKey(context)).toBe(
      `${OPERATIONS_STORAGE_KEY}:10000000-0000-4000-8000-000000000000:10000000-0000-4000-8000-000000000001:10`,
    );
    expect(browserStorage.setItem).toHaveBeenCalledWith(
      getOperationsStorageKey(context),
      expect.any(String),
    );
    expect(browserStorage.getItem).not.toHaveBeenCalledWith(OPERATIONS_STORAGE_KEY);
  });

  it("passes the real session into the hook and stays sanitized when unbound", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const { result } = renderHook(() => useOperations(unboundSession()));

    expect(result.current.state.tasks).toEqual([]);
    expect(result.current.state.files).toEqual([]);
    expect(result.current.context.actor).toBeNull();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("does not read or write decision browser state for an unbound identity", () => {
    const context = createOperationFixtureContext(unboundSession());
    const browserStorage = storage();
    const decision = {
      version: 1 as const,
      stage: "draft" as const,
      input: createDefaultDecisionInput(),
    };

    expect(readStoredDecision(context, browserStorage)).toBeUndefined();
    expect(() => saveStoredDecision(context, decision, browserStorage)).toThrow(
      "当前真实身份未绑定本地业务夹具",
    );
    expect(browserStorage.getItem).not.toHaveBeenCalled();
    expect(browserStorage.setItem).not.toHaveBeenCalled();
  });
});
