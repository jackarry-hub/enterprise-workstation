import { describe, expect, it } from "vitest";

import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { createInitialOperationsState } from "@/features/operations/operations-data";
import { buildOperationProjectDetails } from "@/features/projects/data/operation-project-details";

const executiveSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-executive",
)!;

function initialState() {
  return createInitialOperationsState(createOperationFixtureContext(executiveSession));
}

describe("operation project details", () => {
  it("projects every workstream into a non-empty interactive project", () => {
    const state = initialState();
    const details = buildOperationProjectDetails(state);

    expect(details.map(({ project }) => project.id)).toEqual(
      expect.arrayContaining(state.workstreams.map(({ projectId }) => projectId)),
    );
    expect(details.every(({ tasks }) => tasks.length > 0)).toBe(true);
    expect(details.every(({ owner, members }) => (
      members.some(({ member }) => member.id === owner.id)
    ))).toBe(true);
  });

  it("calculates progress from tasks in the same project only", () => {
    const state = initialState();
    const changed = {
      ...state,
      tasks: state.tasks.map((task) => {
        if (task.projectId === "project-dept-web-delivery") return { ...task, progress: 50 };
        if (task.projectId === "project-dept-payroll-cycle") return { ...task, progress: 0 };
        return task;
      }),
    };

    const details = buildOperationProjectDetails(changed);
    expect(details.find(({ project }) => (
      project.id === "project-dept-web-delivery"
    ))?.project.progress).toBe(50);
    expect(details.find(({ project }) => (
      project.id === "project-dept-payroll-cycle"
    ))?.project.progress).toBe(0);
  });
});
