import { beforeEach, describe, expect, it } from "vitest";

import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import {
  readOperationsState,
  resetOperationsState,
  saveOperationsState,
} from "@/features/operations/operations-data";
import { createDemoTaskRepository } from "@/features/tasks/repositories/demo-task-repository";
import type { RuntimeDispatchWrite } from "@/features/tasks/repositories/task-repository";

const managerSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-product-head",
)!;
const employeeSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-engineer",
)!;

describe("demo task repository", () => {
  beforeEach(() => window.localStorage.clear());

  function createRuntimeDispatchWrite(id: string): RuntimeDispatchWrite {
    const context = createOperationFixtureContext(managerSession);
    const seed = readOperationsState(context);
    const createdAt = "2026-08-15T09:00:00.000Z";
    const workstreamId = `workstream-${id}`;
    const projectId = `project-${id}`;
    const baseTask = seed.tasks.find(({ id: taskId }) => taskId === "dept-task-engineer")!;

    return {
      workstream: {
        id: workstreamId,
        source: "ai_dispatch",
        title: id,
        ownerId: "actor-manager",
        projectId,
        status: "active",
        createdAt,
        updatedAt: createdAt,
      },
      command: {
        ...seed.command,
        id,
        title: id,
        summary: `${id} summary`,
        ownerId: "actor-manager",
        status: "executing",
        projectId,
        createdAt,
        updatedAt: createdAt,
      },
      tasks: [{
        ...baseTask,
        id: `task-${id}`,
        code: `AI-${id}`,
        commandId: id,
        workstreamId,
        projectId,
        runtimeSource: "ai_dispatch",
        creatorId: "actor-manager",
        responsiblePersonId: "actor-manager",
        status: "assigned",
        progress: 0,
        updatedAt: createdAt,
      }],
      event: {
        id: `event-${id}`,
        commandId: id,
        actorId: "actor-manager",
        actorName: managerSession.actor.name,
        action: "AI 确认下发",
        detail: id,
        createdAt,
      },
    };
  }

  it("replaces only the active AI workstream and preserves department business data", async () => {
    const context = createOperationFixtureContext(managerSession);
    const before = resetOperationsState(context);
    const departmentTasks = before.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock");
    const repository = createDemoTaskRepository(context, managerSession);

    await repository.createTasks(createRuntimeDispatchWrite("dispatch-one"));
    const first = readOperationsState(context);
    await repository.createTasks(createRuntimeDispatchWrite("dispatch-two"));
    const second = readOperationsState(context);

    expect(second.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock")).toEqual(departmentTasks);
    expect(second.tasks.some(({ workstreamId }) => workstreamId === first.activeAiWorkstreamId)).toBe(false);
    expect(second.workstreams.some(({ id }) => id === first.activeAiWorkstreamId)).toBe(false);
    expect(second.activeAiWorkstreamId).toBe("workstream-dispatch-two");
    expect(second.supportRequests).toEqual(before.supportRequests);
    expect(second.files).toEqual(before.files);
    expect(second.knowledge).toEqual(before.knowledge);
    expect(second.leaveRequests).toEqual(before.leaveRequests);
    expect(second.attendance).toEqual(before.attendance);
    expect(second.payrollRun).toEqual(before.payrollRun);
  });

  it("resets only the active AI dispatch and keeps department progress", async () => {
    const context = createOperationFixtureContext(managerSession);
    const initial = resetOperationsState(context);
    const departmentTask = initial.tasks.find(({ id }) => id === "dept-task-engineer")!;
    saveOperationsState(context, {
      ...initial,
      tasks: initial.tasks.map((task) => task.id === departmentTask.id
        ? { ...task, status: "in_progress", progress: 50 }
        : task),
    });
    const repository = createDemoTaskRepository(context, managerSession);
    await repository.createTasks(createRuntimeDispatchWrite("dispatch-reset"));

    await repository.resetActiveAiDispatch();

    const reset = readOperationsState(context);
    expect(reset.activeAiWorkstreamId).toBeUndefined();
    expect(reset.tasks.some(({ runtimeSource }) => runtimeSource === "ai_dispatch")).toBe(false);
    expect(reset.tasks.find(({ id }) => id === departmentTask.id)).toMatchObject({
      status: "in_progress",
      progress: 50,
    });
  });

  it("runs a department task through the shared repository state machine", async () => {
    const managerContext = createOperationFixtureContext(managerSession);
    resetOperationsState(managerContext);
    const employeeRepository = createDemoTaskRepository(
      createOperationFixtureContext(employeeSession),
      employeeSession,
    );
    const managerRepository = createDemoTaskRepository(managerContext, managerSession);
    const task = (await employeeRepository.getTasks()).find(({ id }) => id === "dept-task-engineer")!;

    await employeeRepository.acceptTask(task.id);
    await employeeRepository.startTask(task.id);
    await employeeRepository.updateProgress(task.id, 50);
    await employeeRepository.submitTask(task.id, { description: "部门任务成果已完成。" });
    await managerRepository.rejectTask(task.id, "请补充回归说明。 ");
    await employeeRepository.submitTask(task.id, { description: "已补充回归说明并重新提交。" });
    await managerRepository.approveTask(task.id, "验收通过。 ");

    expect(readOperationsState(managerContext).tasks.find(({ id }) => id === task.id)).toMatchObject({
      status: "done",
      progress: 100,
      reviewStatus: "approved",
      rejectionCount: 1,
    });
  });
});
