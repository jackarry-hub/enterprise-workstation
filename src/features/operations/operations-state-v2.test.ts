import { describe, expect, it } from "vitest";

import { createInitialOperationsState } from "@/features/operations/operations-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { normalizeOperationsState } from "@/features/operations/operations-state-v2";
import type { OperationTask } from "@/features/operations/operations-types";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

function withoutOwnershipFields(task: OperationTask) {
  const stored: Partial<OperationTask> = { ...task };
  delete stored.workstreamId;
  delete stored.projectId;
  delete stored.runtimeSource;
  return stored;
}

describe("operations state version 2", () => {
  it("migrates version one without dropping business data", () => {
    const context = createOperationFixtureContext(executiveWorkspaceSession);
    const seed = createInitialOperationsState(context);
    const legacy = {
      ...seed,
      version: 1,
      workstreams: undefined,
      activeAiWorkstreamId: undefined,
      tasks: seed.tasks.map((task) => {
        const stored = withoutOwnershipFields(task);
        if (task.runtimeSource === "ai_dispatch") stored.runtimeSource = "ai_dispatch";
        return stored;
      }),
    };

    const migrated = normalizeOperationsState(legacy, seed);

    expect(migrated.version).toBe(2);
    expect(migrated.supportRequests).toEqual(seed.supportRequests);
    expect(migrated.files).toEqual(seed.files);
    expect(migrated.knowledge).toEqual(seed.knowledge);
    expect(migrated.dispatchHistory).toEqual(seed.dispatchHistory);
    expect(migrated.tasks.every((task) => task.workstreamId && task.projectId)).toBe(true);
  });

  it("restores department ownership fields missing from stored version two tasks", () => {
    const context = createOperationFixtureContext(executiveWorkspaceSession);
    const seed = createInitialOperationsState(context);
    const departmentTask = seed.tasks.find(({ id }) => id === "dept-task-finance")!;
    const stored = {
      ...seed,
      tasks: [withoutOwnershipFields(departmentTask)],
    };

    const normalized = normalizeOperationsState(stored, seed);

    expect(normalized.tasks).toContainEqual(expect.objectContaining({
      id: departmentTask.id,
      workstreamId: "dept-payroll-cycle",
      projectId: "project-dept-payroll-cycle",
      runtimeSource: "department_mock",
    }));
  });
});
