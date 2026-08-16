import { beforeEach, describe, expect, it } from "vitest";

import { dispatchAiPlanToOperations } from "@/features/ai-dispatch/dispatch-to-operations";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import {
  getOperationActionItems,
  getOperationNotifications,
  readOperationsState,
  saveOperationsState,
  setCommandStatus,
} from "@/features/operations/operations-data";
import { validDispatchPlan } from "@/test/ai-dispatch-test-utils";
import { createDemoTaskRepository } from "@/features/tasks/repositories/demo-task-repository";
import { validExecutionSummary } from "@/features/ai-dispatch/summary-contract.test";

const departmentHead = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-product-head",
)!;
const employee = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-engineer",
)!;

describe("DeepSeek plan operations adapter", () => {
  beforeEach(() => window.localStorage.clear());

  it("lets the non-executive command owner finish the command closure", async () => {
    const context = createOperationFixtureContext(departmentHead);
    await dispatchAiPlanToOperations(context, validDispatchPlan, departmentHead, {
      now: () => new Date("2026-08-14T09:00:00.000Z"),
      createId: () => "owner-closure",
    });
    const dispatched = readOperationsState(context);
    saveOperationsState(context, {
      ...dispatched,
      tasks: dispatched.tasks.map((task) => task.workstreamId === dispatched.activeAiWorkstreamId
        ? { ...task, status: "done", progress: 100 }
        : task),
    });

    setCommandStatus(context, "review", "actor-manager");

    expect(readOperationsState(context).command.status).toBe("review");
  });

  it("isolates runtime tasks by the current demo employee", async () => {
    const managerContext = createOperationFixtureContext(departmentHead);
    await dispatchAiPlanToOperations(managerContext, validDispatchPlan, departmentHead, {
      createId: () => "task-isolation",
    });
    const employeeRepository = createDemoTaskRepository(
      createOperationFixtureContext(employee),
      employee,
    );

    const employeeTasks = await employeeRepository.getTasksByUser("actor-employee");
    const runtimeTask = employeeTasks.find(({ runtimeSource }) => runtimeSource === "ai_dispatch")!;

    expect(employeeTasks).toHaveLength(2);
    expect(employeeTasks).toContainEqual(expect.objectContaining({
      id: "dept-task-engineer",
      runtimeSource: "department_mock",
    }));
    expect(runtimeTask).toMatchObject({
      title: "完成移动端开发",
      assigneeId: "actor-employee",
      creatorId: "actor-manager",
      responsiblePersonId: "actor-manager",
      status: "assigned",
      progress: 0,
      estimatedHours: 16,
      aiReason: "具备前端开发与系统联调能力。",
    });
    expect(getOperationActionItems(readOperationsState(managerContext), "actor-employee")).toContainEqual(
      expect.objectContaining({
        kind: "task_ready",
        title: "接受新任务：完成移动端开发",
        href: `/execution#task-${runtimeTask.id}`,
      }),
    );
  });

  it("runs an employee task through accept, submit, return, resubmit, and approval", async () => {
    const managerContext = createOperationFixtureContext(departmentHead);
    await dispatchAiPlanToOperations(managerContext, validDispatchPlan, departmentHead, {
      now: () => new Date("2026-08-14T09:00:00.000Z"),
      createId: () => "runtime-lifecycle",
    });
    const employeeRepository = createDemoTaskRepository(
      createOperationFixtureContext(employee),
      employee,
    );
    const managerRepository = createDemoTaskRepository(managerContext, departmentHead);
    const employeeTasks = await employeeRepository.getTasksByUser("actor-employee");
    const task = employeeTasks.find(({ runtimeSource }) => runtimeSource === "ai_dispatch")!;
    const departmentTask = employeeTasks.find(({ runtimeSource }) => runtimeSource === "department_mock")!;

    await employeeRepository.acceptTask(task.id);
    await employeeRepository.startTask(task.id);
    await employeeRepository.updateProgress(task.id, 50);
    await employeeRepository.submitTask(task.id, {
      description: "移动端首页、任务页和身份切换已经完成。",
      url: "https://demo.example.test/mobile-v1",
      attachmentName: "mobile-v1-checklist.pdf",
      note: "请重点检查 390px 宽度。",
    });

    let stored = readOperationsState(managerContext).tasks.find(({ id }) => id === task.id)!;
    expect(stored).toMatchObject({
      status: "review",
      progress: 90,
      reviewStatus: "pending",
      submission: {
        description: "移动端首页、任务页和身份切换已经完成。",
        url: "https://demo.example.test/mobile-v1",
        attachmentName: "mobile-v1-checklist.pdf",
        note: "请重点检查 390px 宽度。",
      },
    });

    await managerRepository.rejectTask(task.id, "登录页在390px设备存在横向溢出，请修复。");
    stored = readOperationsState(managerContext).tasks.find(({ id }) => id === task.id)!;
    expect(stored).toMatchObject({
      status: "in_progress",
      reviewStatus: "rejected",
      reviewComment: "登录页在390px设备存在横向溢出，请修复。",
      rejectionCount: 1,
    });

    await employeeRepository.submitTask(task.id, {
      description: "已修复390px横向溢出并完成回归。",
      attachmentName: "mobile-v1-fixed.png",
    });
    await managerRepository.approveTask(task.id, "回归验证通过，同意验收。");

    stored = readOperationsState(managerContext).tasks.find(({ id }) => id === task.id)!;
    expect(stored).toMatchObject({
      status: "done",
      progress: 100,
      reviewStatus: "approved",
      reviewComment: "回归验证通过，同意验收。",
      reviewedById: "actor-manager",
      rejectionCount: 1,
    });
    expect(stored.acceptedAt).toBeTruthy();
    expect(stored.startedAt).toBeTruthy();
    expect(stored.submission?.submittedAt).toBeTruthy();
    expect(stored.reviewedAt).toBeTruthy();
    expect(readOperationsState(managerContext).tasks.find(({ id }) => id === departmentTask.id)).toMatchObject({
      status: "assigned",
      progress: 0,
      runtimeSource: "department_mock",
    });
  });

  it("automatically completes the dispatch and notifies its creator after the last approval", async () => {
    const managerContext = createOperationFixtureContext(departmentHead);
    await dispatchAiPlanToOperations(managerContext, validDispatchPlan, departmentHead, {
      createId: () => "automatic-completion",
    });
    const dispatched = readOperationsState(managerContext);
    const aiTasks = dispatched.tasks.filter(({ workstreamId }) => (
      workstreamId === dispatched.activeAiWorkstreamId
    ));
    const lastTask = aiTasks.find(({ assigneeId }) => assigneeId === "actor-employee")!;
    saveOperationsState(managerContext, {
      ...dispatched,
      tasks: dispatched.tasks.map((task) => {
        if (task.workstreamId !== dispatched.activeAiWorkstreamId) return task;
        if (task.id !== lastTask.id) {
          return { ...task, status: "done", progress: 100, reviewStatus: "approved" };
        }
        return {
          ...task,
          status: "review",
          progress: 90,
          reviewStatus: "pending",
          submission: {
            description: "最终成果已经提交。",
            submittedAt: "2026-08-16T10:00:00.000Z",
          },
        };
      }),
    });
    const managerRepository = createDemoTaskRepository(managerContext, departmentHead);

    await managerRepository.approveTask(lastTask.id, "最后一项成果验收通过。");

    const completed = readOperationsState(managerContext);
    expect(completed.command.status).toBe("accepted");
    expect(completed.tasks.filter(({ workstreamId }) => (
      workstreamId === completed.activeAiWorkstreamId
    )).every(({ status }) => status === "done")).toBe(true);
    expect(completed.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock").some(
      ({ status }) => status !== "done",
    )).toBe(true);
    expect(getOperationNotifications(completed, "actor-manager")).toContainEqual(expect.objectContaining({
      title: "本次目标已经全部完成",
      description: validDispatchPlan.goal,
      href: "/dashboard#ai-dispatch-progress",
    }));

    await managerRepository.saveDispatchSummary(validExecutionSummary, "deepseek-v4-flash");
    await managerRepository.archiveDispatch();

    const archived = readOperationsState(managerContext);
    expect(archived.command.status).toBe("archived");
    expect(archived.command.aiSummary).toEqual(validExecutionSummary);
    expect(archived.dispatchHistory).toContainEqual(expect.objectContaining({
      commandId: archived.command.id,
      goal: validDispatchPlan.goal,
      taskCount: 3,
      rejectionCount: 0,
      aiSummary: validExecutionSummary,
    }));
  });
});
