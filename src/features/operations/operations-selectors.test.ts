import { describe, expect, it } from "vitest";

import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { createInitialOperationsState } from "@/features/operations/operations-data";
import {
  selectAssignedTasks,
  selectInitiatedTasks,
  selectProjectProgress,
  selectReviewTasks,
  selectTodayActions,
} from "@/features/operations/operations-selectors";
import type { OperationTask, OperationsState } from "@/features/operations/operations-types";

const employeeSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-engineer",
)!;
const managerSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-product-head",
)!;

function fixture() {
  const employee = createOperationFixtureContext(employeeSession).actor!;
  const manager = createOperationFixtureContext(managerSession).actor!;
  const state = createInitialOperationsState(createOperationFixtureContext(employeeSession));
  return { employee, manager, state };
}

function withTask(
  state: OperationsState,
  taskId: string,
  patch: Partial<OperationTask>,
): OperationsState {
  return {
    ...state,
    tasks: state.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task),
  };
}

describe("operations selectors", () => {
  it("keeps assigned and initiated scopes isolated to the current person", () => {
    const { employee, manager, state } = fixture();

    expect(selectAssignedTasks(state, employee.id).every(
      ({ assigneeId }) => assigneeId === employee.id,
    )).toBe(true);
    expect(selectAssignedTasks(state, manager.id).every(
      ({ assigneeId }) => assigneeId === manager.id,
    )).toBe(true);
    expect(selectInitiatedTasks(state, manager.id).every((task) => (
      task.assigneeId !== manager.id
      && (task.creatorId === manager.id || task.departmentOwnerId === manager.id)
    ))).toBe(true);
  });

  it("moves submitted work to the reviewer and removes completed work from today", () => {
    const { employee, manager, state } = fixture();
    const task = state.tasks.find(({ assigneeId }) => assigneeId === employee.id)!;
    const submitted = withTask(state, task.id, { status: "review", progress: 90 });

    expect(selectTodayActions(submitted, employee).some(({ taskId }) => taskId === task.id)).toBe(false);
    expect(selectReviewTasks(submitted, manager.id).map(({ id }) => id)).toContain(task.id);
    expect(selectTodayActions(submitted, manager)).toContainEqual(expect.objectContaining({
      taskId: task.id,
      kind: "review",
      href: expect.stringContaining(`#review-${task.id}`),
    }));

    const completed = withTask(submitted, task.id, { status: "done", progress: 100 });
    expect(selectTodayActions(completed, manager).some(({ taskId }) => taskId === task.id)).toBe(false);
  });

  it("calculates progress from tasks in the requested project only", () => {
    const { state } = fixture();
    const projectId = "project-dept-web-delivery";
    const changed = {
      ...state,
      tasks: state.tasks.map((task) => ({
        ...task,
        progress: task.projectId === projectId ? 50 : 100,
      })),
    };

    expect(selectProjectProgress(changed, projectId)).toBe(50);
    expect(selectProjectProgress(changed, "project-dept-payroll-cycle")).toBe(100);
  });
});
