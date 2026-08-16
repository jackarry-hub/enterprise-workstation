import { beforeEach, describe, expect, it } from "vitest";

import {
  createDecisionPlan,
  createDefaultDecisionInput,
  dispatchDecisionPlan as dispatchDecisionPlanWithContext,
} from "@/features/decision-workbench/decision-workbench-data";
import {
  addOperationFile as addOperationFileWithContext,
  applyTaskEscalations,
  getActorByMemberId,
  getActor,
  getOperationsStorageKey,
  getOperationActionItems,
  getOperationNotifications,
  getOperationWeeklySummary,
  getTaskReviewerId,
  lockAttendancePeriod as lockAttendancePeriodWithContext,
  markOperationNotificationRead as markOperationNotificationReadWithContext,
  OPERATIONS_STORAGE_KEY,
  readOperationsState as readOperationsStateWithContext,
  resetOperationsState as resetOperationsStateWithContext,
  saveOperationsState as saveOperationsStateWithContext,
  reviewAttendanceCorrection as reviewAttendanceCorrectionWithContext,
  reviewOvertimeRequest as reviewOvertimeRequestWithContext,
  reviewLeaveRequest as reviewLeaveRequestWithContext,
  submitLeaveRequest as submitLeaveRequestWithContext,
  syncProjectTasksToOperations as syncProjectTasksToOperationsWithContext,
  updateOperationTask as updateOperationTaskWithContext,
  updatePayrollRun as updatePayrollRunWithContext,
} from "@/features/operations/operations-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import {
  clearLocalProjects,
  findLocalProject,
  saveLocalProject,
} from "@/features/projects/data/mock-project-repository";
import { updateMockTaskStatus } from "@/features/projects/data/project-task-operations";
import { mockMembers } from "@/features/projects/mock-data";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import type { OperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { customerDemoPeople, customerDemoSessions } from "@/features/demo/customer-demo-data";

type Tail<T extends readonly unknown[]> = T extends readonly [unknown, ...infer Rest] ? Rest : never;

const boundContext: OperationFixtureContext = {
  ...createOperationFixtureContext(executiveWorkspaceSession),
  storageNamespace: "test-shared-operations",
};
const contextFor = (actorId: string): OperationFixtureContext => ({
  ...boundContext,
  actor: getActor(actorId),
});
const dispatchDecisionPlan = (...args: Tail<Parameters<typeof dispatchDecisionPlanWithContext>>) => dispatchDecisionPlanWithContext(boundContext, ...args);
const addOperationFile = (...args: Tail<Parameters<typeof addOperationFileWithContext>>) => addOperationFileWithContext(contextFor(args[0].uploadedById), ...args);
const lockAttendancePeriod = (...args: Tail<Parameters<typeof lockAttendancePeriodWithContext>>) => lockAttendancePeriodWithContext(contextFor(args[0]), ...args);
const markOperationNotificationRead = (...args: Tail<Parameters<typeof markOperationNotificationReadWithContext>>) => markOperationNotificationReadWithContext(contextFor(args[1]), ...args);
const readOperationsState = (...args: Tail<Parameters<typeof readOperationsStateWithContext>>) => readOperationsStateWithContext(boundContext, ...args);
const resetOperationsState = (...args: Tail<Parameters<typeof resetOperationsStateWithContext>>) => resetOperationsStateWithContext(boundContext, ...args);
const saveOperationsState = (...args: Tail<Parameters<typeof saveOperationsStateWithContext>>) => saveOperationsStateWithContext(boundContext, ...args);
const reviewAttendanceCorrection = (...args: Tail<Parameters<typeof reviewAttendanceCorrectionWithContext>>) => reviewAttendanceCorrectionWithContext(contextFor(args[2]), ...args);
const reviewOvertimeRequest = (...args: Tail<Parameters<typeof reviewOvertimeRequestWithContext>>) => reviewOvertimeRequestWithContext(contextFor(args[2]), ...args);
const reviewLeaveRequest = (...args: Tail<Parameters<typeof reviewLeaveRequestWithContext>>) => reviewLeaveRequestWithContext(contextFor(args[2]), ...args);
const submitLeaveRequest = (...args: Tail<Parameters<typeof submitLeaveRequestWithContext>>) => submitLeaveRequestWithContext(contextFor(args[1]), ...args);
const syncProjectTasksToOperations = (
  detail: Parameters<typeof syncProjectTasksToOperationsWithContext>[1],
  actorId: string,
) => syncProjectTasksToOperationsWithContext(contextFor(actorId), detail, actorId, executiveWorkspaceSession.actor);
const updateOperationTask = (
  taskId: Parameters<typeof updateOperationTaskWithContext>[1],
  patch: Parameters<typeof updateOperationTaskWithContext>[2],
  actorId: string,
) => updateOperationTaskWithContext(contextFor(actorId), taskId, patch, actorId, executiveWorkspaceSession.actor);
const updatePayrollRun = (...args: Tail<Parameters<typeof updatePayrollRunWithContext>>) => updatePayrollRunWithContext(contextFor(args[1]), ...args);

describe("operations business closure", () => {
  beforeEach(() => {
    clearLocalProjects(boundContext);
    window.localStorage.removeItem(OPERATIONS_STORAGE_KEY);
    resetOperationsState();
  });

  it("exposes the complete version 2 department seed before AI dispatch", () => {
    const demoContext = createOperationFixtureContext(customerDemoSessions[0]);
    const state = resetOperationsStateWithContext(demoContext);
    const expectedActorIds = customerDemoPeople.map(({ actorId }) => actorId);

    expect(state).toMatchObject({
      version: 2,
      activeAiWorkstreamId: undefined,
      command: { id: "command-idle", status: "archived" },
    });
    expect(state.workstreams).toHaveLength(3);
    expect(state.workstreams.every(({ source }) => source === "department_mock")).toBe(true);
    expect(new Set(state.tasks.map(({ assigneeId }) => assigneeId))).toEqual(
      new Set(expectedActorIds),
    );
    expect(state.tasks).toHaveLength(10);
    expect(state.tasks.every(({ status, progress, runtimeSource }) => (
      status === "assigned" && progress === 0 && runtimeSource === "department_mock"
    ))).toBe(true);
    expect(getOperationWeeklySummary(state, "actor-executive").completionRate).toBe(0);
    expect(state.supportRequests).not.toHaveLength(0);
    expect(state.knowledge).not.toHaveLength(0);
    expect(state.leaveRequests).not.toHaveLength(0);
    expect(state.attendance.corrections).not.toHaveLength(0);
    expect(state.payrollRun).toMatchObject({ status: "draft", attendanceLocked: false });
    expect(state.events).not.toHaveLength(0);
  });

  it("migrates version 1 AI tasks into a deterministic active legacy workstream without misclassifying department tasks", () => {
    const seed = resetOperationsState();
    const legacyCommandId = "legacy-ai-command";
    const legacyProjectId = "legacy-ai-project";
    const legacyState = JSON.parse(JSON.stringify(seed)) as Record<string, unknown> & {
      command: Record<string, unknown>;
      tasks: Array<Record<string, unknown>>;
    };
    legacyState.version = 1;
    delete legacyState.workstreams;
    delete legacyState.activeAiWorkstreamId;
    legacyState.command = {
      ...legacyState.command,
      id: legacyCommandId,
      title: "遗留 AI 调度",
      projectId: legacyProjectId,
      status: "executing",
    };
    legacyState.tasks = [
      { ...seed.tasks.find(({ id }) => id === "dept-task-engineer")!, id: "legacy-ai-task", commandId: legacyCommandId },
      { ...seed.tasks.find(({ id }) => id === "dept-task-finance")!, id: "legacy-department-task", commandId: "department-payroll" },
    ].map((task) => {
      const legacyTask = { ...task } as Record<string, unknown>;
      delete legacyTask.workstreamId;
      delete legacyTask.projectId;
      delete legacyTask.runtimeSource;
      return legacyTask;
    });
    window.localStorage.setItem(getOperationsStorageKey(boundContext)!, JSON.stringify(legacyState));

    const migrated = readOperationsState();
    const legacyWorkstreamId = `legacy-ai-workstream-${legacyCommandId}`;

    expect(migrated.version).toBe(2);
    expect(migrated.activeAiWorkstreamId).toBe(legacyWorkstreamId);
    expect(migrated.workstreams).toContainEqual(expect.objectContaining({
      id: legacyWorkstreamId,
      source: "ai_dispatch",
      projectId: legacyProjectId,
      status: "active",
    }));
    expect(migrated.tasks.find(({ id }) => id === "legacy-ai-task")).toMatchObject({
      workstreamId: legacyWorkstreamId,
      projectId: legacyProjectId,
      runtimeSource: "ai_dispatch",
    });
    expect(migrated.tasks.find(({ id }) => id === "legacy-department-task")).toMatchObject({
      workstreamId: "dept-payroll-cycle",
      projectId: "project-dept-payroll-cycle",
      runtimeSource: "department_mock",
    });
  });

  it("maps every project member to an explicit workspace actor", () => {
    expect(mockMembers.map(({ id }) => getActorByMemberId(id)?.memberId)).toEqual(
      mockMembers.map(({ id }) => id),
    );
  });

  it("keeps decision, project, task center, and personal execution on the same task state", () => {
    const now = new Date("2026-08-09T08:00:00.000Z");
    const input = createDefaultDecisionInput(now);
    const plan = createDecisionPlan(input, now);
    const dispatched = dispatchDecisionPlan(input, plan, now);
    const operationState = readOperationsState();
    const operationTask = operationState.tasks.find(({ workstreamId }) => (
      workstreamId === operationState.activeAiWorkstreamId
    ))!;

    expect(operationState.command.projectId).toBe(dispatched.project.id);
    expect(operationTask.commandId).toBe(operationState.command.id);
    updateOperationTask(
      operationTask.id,
      { status: "in_progress", progress: 35 },
      operationTask.assigneeId,
    );

    const projectAfterExecution = findLocalProject(boundContext, dispatched.project.id)!;
    expect(projectAfterExecution.tasks.find(({ id }) => id === operationTask.id)).toMatchObject({
      status: "in_progress",
      progress: 35,
    });
    expect(projectAfterExecution.activities[0]).toMatchObject({
      userId: executiveWorkspaceSession.actor.id,
      actionType: "task_updated",
    });
    expect(projectAfterExecution.activities[0].content).toContain(executiveWorkspaceSession.actor.name);
    expect(projectAfterExecution.activities[0].content).not.toContain(getActor(operationTask.assigneeId).name);

    const completedProject = updateMockTaskStatus(
      projectAfterExecution,
      operationTask.id,
      "done",
      executiveWorkspaceSession.actor,
      {
        now: () => new Date("2026-08-09T09:00:00.000Z"),
        createId: () => "activity-sync-test",
      },
    );
    saveLocalProject(boundContext, completedProject);
    syncProjectTasksToOperations(completedProject, "actor-manager");

    expect(readOperationsState().tasks.find(({ id }) => id === operationTask.id)).toMatchObject({
      status: "done",
      progress: 100,
    });
  });

  it("routes a department owner's own deliverable to executive review", () => {
    const now = new Date("2026-08-09T08:00:00.000Z");
    const input = createDefaultDecisionInput(now);
    dispatchDecisionPlan(input, createDecisionPlan(input, now), now);
    const ownerTask = readOperationsState().tasks.find(({ runtimeSource, assigneeId, departmentOwnerId }) => (
      runtimeSource === "ai_dispatch" && assigneeId === departmentOwnerId
    ))!;

    expect(getTaskReviewerId(ownerTask)).toBe("actor-executive");
    updateOperationTask(ownerTask.id, { status: "in_progress" }, ownerTask.assigneeId);
    addOperationFile({ id: "file-owner-review", commandId: ownerTask.commandId, entityType: "task", entityId: ownerTask.id, name: "负责人交付.pdf", mimeType: "application/pdf", sizeBytes: 4096, version: 1, uploadedById: ownerTask.assigneeId, provider: "indexeddb", objectPath: "file-owner-review", createdAt: "2026-08-09T10:10:00.000Z" });
    updateOperationTask(ownerTask.id, { status: "review" }, ownerTask.assigneeId);

    expect(() => updateOperationTask(ownerTask.id, { status: "done", reviewNote: "自验通过" }, ownerTask.assigneeId)).toThrow("只有指定验收人");
    updateOperationTask(ownerTask.id, { status: "done", reviewNote: "领导验收通过" }, "actor-executive");
    expect(readOperationsState().tasks.find(({ id }) => id === ownerTask.id)?.status).toBe("done");
  });

  it("keeps the complete professional demo dataset in one repository", () => {
    const state = readOperationsState();
    expect(state.tasks.length).toBeGreaterThanOrEqual(6);
    expect(state.supportRequests.some(({ type }) => type === "finance")).toBe(true);
    expect(state.supportRequests.some(({ type }) => type === "staffing")).toBe(true);
    expect(state.leaveRequests.some(({ status }) => status === "pending_manager")).toBe(true);
    expect(state.attendance.policy.workStart).toBe("09:00");
    expect(state.attendance.period.status).toBe("review");
    expect(state.payrollRun.status).toBe("draft");
    expect(state.payrollRun.attendanceLocked).toBe(false);
    expect(state.knowledge.length).toBeGreaterThan(0);
  });

  it("lets every assignee start their own work even when a reference dependency is unfinished", () => {
    const state = readOperationsState();
    const downstream = state.tasks.find(({ id }) => id === "dept-task-engineer")!;

    updateOperationTask(downstream.id, { status: "accepted" }, downstream.assigneeId);
    updateOperationTask(downstream.id, { status: "in_progress" }, downstream.assigneeId);
    expect(readOperationsState().tasks.find(({ id }) => id === downstream.id)?.status).toBe("in_progress");
    expect(getOperationActionItems(readOperationsState(), downstream.assigneeId, new Date("2026-08-09T08:00:00.000Z"))).not.toContainEqual(
      expect.objectContaining({ entityId: downstream.id, kind: "task_blocked" }),
    );
  });

  it("adds an active AI workstream without deleting department tasks or non-AI business data", () => {
    const initial = readOperationsState();
    const sentinelFile = {
      id: "file-preserved-across-dispatch",
      commandId: initial.command.id,
      entityType: "knowledge" as const,
      entityId: initial.knowledge[0].id,
      name: "既有知识附件.txt",
      mimeType: "text/plain",
      sizeBytes: 128,
      version: 1,
      uploadedById: "actor-manager",
      provider: "indexeddb" as const,
      objectPath: "preserved/file.txt",
      createdAt: "2026-08-14T09:30:00.000Z",
    };
    const before = saveOperationsState({ ...initial, files: [sentinelFile] });
    const departmentTaskIds = before.tasks
      .filter(({ runtimeSource }) => runtimeSource === "department_mock")
      .map(({ id }) => id);
    const input = createDefaultDecisionInput(new Date("2026-08-14T10:00:00.000Z"));
    const plan = createDecisionPlan(input, new Date("2026-08-14T10:00:00.000Z"));

    dispatchDecisionPlan(input, plan, new Date("2026-08-14T10:00:00.000Z"));
    const after = readOperationsState();
    const activeId = after.activeAiWorkstreamId!;

    expect(activeId).toBe(plan.id);
    expect(after.workstreams).toContainEqual(expect.objectContaining({
      id: activeId,
      source: "ai_dispatch",
      projectId: after.command.projectId,
      status: "active",
    }));
    expect(after.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock").map(({ id }) => id)).toEqual(departmentTaskIds);
    expect(after.tasks.filter(({ workstreamId }) => workstreamId === activeId)).toHaveLength(10);
    expect(after.supportRequests).toEqual(before.supportRequests);
    expect(after.files).toEqual(before.files);
    expect(after.knowledge).toEqual(before.knowledge);
    expect(after.leaveRequests).toEqual(before.leaveRequests);
    expect(after.attendance).toEqual(before.attendance);
    expect(after.payrollRun).toEqual(before.payrollRun);
    expect(after.dispatchHistory).toEqual(before.dispatchHistory);
    expect(after.events).toEqual(expect.arrayContaining(before.events));
  });

  it("updates a retained department task during an active AI dispatch without writing to the AI project", () => {
    const now = new Date("2026-08-14T10:00:00.000Z");
    const input = createDefaultDecisionInput(now);
    const plan = createDecisionPlan(input, now);
    const dispatched = dispatchDecisionPlan(input, plan, now);
    const departmentTask = readOperationsState().tasks.find(({ runtimeSource }) => (
      runtimeSource === "department_mock"
    ))!;
    const aiProjectBefore = findLocalProject(boundContext, dispatched.project.id)!;

    const updated = updateOperationTask(
      departmentTask.id,
      { status: "accepted" },
      departmentTask.assigneeId,
    );

    expect(updated.tasks.find(({ id }) => id === departmentTask.id)?.status).toBe("accepted");
    expect(readOperationsState().tasks.find(({ id }) => id === departmentTask.id)?.status).toBe("accepted");
    expect(findLocalProject(boundContext, dispatched.project.id)).toEqual(aiProjectBefore);
  });

  it("replaces only the previous active AI workstream when a new plan is dispatched", () => {
    const firstInput = createDefaultDecisionInput(new Date("2026-08-14T10:00:00.000Z"));
    const firstPlan = createDecisionPlan(firstInput, new Date("2026-08-14T10:00:00.000Z"));
    dispatchDecisionPlan(firstInput, firstPlan, new Date("2026-08-14T10:00:00.000Z"));
    const first = readOperationsState();
    const departmentTaskIds = first.tasks
      .filter(({ runtimeSource }) => runtimeSource === "department_mock")
      .map(({ id }) => id);

    const secondInput = {
      ...createDefaultDecisionInput(new Date("2026-08-15T10:00:00.000Z")),
      goal: "建立第二轮客户运营改进闭环",
    };
    const secondPlan = createDecisionPlan(secondInput, new Date("2026-08-15T10:00:00.000Z"));
    dispatchDecisionPlan(secondInput, secondPlan, new Date("2026-08-15T10:00:00.000Z"));
    const second = readOperationsState();

    expect(second.activeAiWorkstreamId).toBe(secondPlan.id);
    expect(second.activeAiWorkstreamId).not.toBe(first.activeAiWorkstreamId);
    expect(second.workstreams.some(({ id }) => id === first.activeAiWorkstreamId)).toBe(false);
    expect(second.tasks.some(({ workstreamId }) => workstreamId === first.activeAiWorkstreamId)).toBe(false);
    expect(second.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock").map(({ id }) => id)).toEqual(departmentTaskIds);
    expect(second.tasks.filter(({ workstreamId }) => workstreamId === second.activeAiWorkstreamId)).toHaveLength(10);
  });

  it("completes the active AI workstream even while department tasks remain unfinished", () => {
    const initial = readOperationsState();
    const sourceTask = initial.tasks.find(({ assigneeId }) => assigneeId === "actor-employee")!;
    const activeAiWorkstreamId = "ai-workstream-completion-test";
    const commandId = "ai-command-completion-test";
    const aiTasks = [
      { ...sourceTask, id: "ai-complete-1", code: "AI-01", commandId, workstreamId: activeAiWorkstreamId, projectId: "ai-project-completion-test", runtimeSource: "ai_dispatch" as const, status: "done" as const, progress: 100, deliverableRequired: false },
      { ...sourceTask, id: "ai-complete-2", code: "AI-02", commandId, workstreamId: activeAiWorkstreamId, projectId: "ai-project-completion-test", runtimeSource: "ai_dispatch" as const, status: "review" as const, progress: 90, deliverableRequired: false },
    ];
    saveOperationsState({
      ...initial,
      activeAiWorkstreamId,
      workstreams: [...initial.workstreams, {
        id: activeAiWorkstreamId,
        source: "ai_dispatch",
        title: "AI 完成判定测试",
        ownerId: "actor-executive",
        projectId: "ai-project-completion-test",
        status: "active",
        createdAt: "2026-08-14T10:00:00.000Z",
        updatedAt: "2026-08-14T10:00:00.000Z",
      }],
      command: {
        ...initial.command,
        id: commandId,
        title: "AI 完成判定测试",
        ownerId: "actor-executive",
        status: "executing",
      },
      tasks: [...initial.tasks, ...aiTasks],
    });

    const completed = updateOperationTask("ai-complete-2", { status: "done", reviewNote: "AI 成果验收通过" }, "actor-manager");
    const departmentTasks = completed.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock");

    expect(departmentTasks.some(({ status }) => status !== "done")).toBe(true);
    expect(completed.command.status).toBe("accepted");
    expect(completed.workstreams.find(({ id }) => id === activeAiWorkstreamId)?.status).toBe("completed");
    expect(completed.events).toContainEqual(expect.objectContaining({
      action: "AI 调度目标完成",
      detail: expect.stringContaining("2 项任务"),
    }));
  });

  it("routes every inbox action to the exact item that needs handling", () => {
    const state = readOperationsState();

    expect(getOperationActionItems(state, "actor-finance")).toContainEqual(
      expect.objectContaining({ entityId: "support-finance-01", href: "/finance#support-support-finance-01" }),
    );
    expect(getOperationActionItems(state, "actor-manager")).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: "leave-202608-01", href: "/leave#leave-leave-202608-01" }),
      expect.objectContaining({ href: expect.stringMatching(/^\/attendance#attendance-/) }),
    ]));
  });

  it("keeps another person's overdue task out of the executive action inbox", () => {
    const now = new Date("2026-08-15T08:00:00.000Z");
    const initial = readOperationsState();
    const target = initial.tasks.find(({ id }) => id === "dept-task-engineer")!;
    const overdueReview = {
      ...initial,
      tasks: initial.tasks.map((task) => task.id === target.id ? {
        ...task,
        status: "review" as const,
        reviewDueAt: "2026-08-14T08:00:00.000Z",
      } : task),
    };
    const escalated = applyTaskEscalations(overdueReview, now);
    const reviewTask = escalated.tasks.find(({ id }) => id === target.id)!;
    const actions = getOperationActionItems(escalated, "actor-executive", now);
    const summary = getOperationWeeklySummary(escalated, "actor-executive", now);

    expect(reviewTask.escalationLevel).toBe("executive");
    expect(actions).not.toContainEqual(expect.objectContaining({ entityId: reviewTask.id }));
    expect(summary.decisions).toContain(`需协调：${reviewTask.title}`);
  });

  it("generates role notifications from live actions and persists read receipts", () => {
    const now = new Date("2026-08-15T08:00:00.000Z");
    const initial = readOperationsState();
    const target = initial.tasks.find(({ id }) => id === "dept-task-engineer")!;
    const state = applyTaskEscalations({
      ...initial,
      tasks: initial.tasks.map((task) => task.id === target.id ? {
        ...task,
        status: "review" as const,
        reviewDueAt: "2026-08-14T08:00:00.000Z",
      } : task),
    }, now);
    saveOperationsState(state);
    const notifications = getOperationNotifications(state, "actor-executive", now);
    const critical = notifications.find(({ severity }) => severity === "critical")!;

    expect(critical).toBeTruthy();
    expect(critical.read).toBe(false);
    markOperationNotificationRead(critical.id, "actor-executive");
    expect(getOperationNotifications(readOperationsState(), "actor-executive", now).find(({ id }) => id === critical.id)?.read).toBe(true);
  });

  it("builds the leadership weekly brief from the same execution state", () => {
    const initial = readOperationsState();
    const target = initial.tasks.find(({ id }) => id === "dept-task-engineer")!;
    const state = {
      ...initial,
      tasks: initial.tasks.map((task) => task.id === target.id ? {
        ...task,
        status: "review" as const,
        escalationLevel: "executive" as const,
      } : task),
    };
    const summary = getOperationWeeklySummary(state, "actor-executive", new Date("2026-08-09T08:00:00.000Z"));

    expect(summary.total).toBe(state.tasks.length);
    expect(summary.completionRate).toBe(Math.round((summary.completed / summary.total) * 100));
    expect(summary.dependencyRisks).toBe(0);
    expect(summary.decisions.length).toBeGreaterThanOrEqual(1);
    expect(summary.narrative).toContain("完成率");
  });

  it("requires a deliverable and archives an accepted task as knowledge", () => {
    const task = readOperationsState().tasks.find(({ id }) => id === "dept-task-engineer")!;
    updateOperationTask(task.id, { status: "accepted" }, "actor-employee");
    updateOperationTask(task.id, { status: "in_progress" }, "actor-employee");
    addOperationFile({ id: "file-test", commandId: task.commandId, entityType: "task", entityId: task.id, name: "验收成果.pdf", mimeType: "application/pdf", sizeBytes: 1024, version: 1, uploadedById: "actor-employee", provider: "indexeddb", objectPath: "file-test", createdAt: "2026-08-08T12:00:00.000Z" });
    updateOperationTask(task.id, { status: "review" }, "actor-employee");
    updateOperationTask(task.id, { status: "done", reviewNote: "符合验收标准" }, "actor-manager");
    const state = readOperationsState();
    expect(state.tasks.find(({ id }) => id === task.id)?.status).toBe("done");
    expect(state.knowledge.find(({ sourceTaskId }) => sourceTaskId === task.id)?.fileIds).toContain("file-test");
  });

  it("closes all ten AI tasks while preserving unfinished department tasks", () => {
    const sessionForActor = (actorId: string) => {
      const person = customerDemoPeople.find(({ actorId: candidateId }) => candidateId === actorId)!;
      return customerDemoSessions.find(({ identity }) => identity.providerSubject === `customer-demo:${person.id}`)!;
    };
    const executiveSession = sessionForActor("actor-executive");
    const executiveContext = createOperationFixtureContext(executiveSession);
    const input = createDefaultDecisionInput();
    const plan = createDecisionPlan(input);
    resetOperationsStateWithContext(executiveContext);
    dispatchDecisionPlanWithContext(executiveContext, input, plan);

    const dispatched = readOperationsStateWithContext(executiveContext);
    const activeAiWorkstreamId = dispatched.activeAiWorkstreamId!;
    const dispatchedAiTasks = dispatched.tasks.filter(({ workstreamId }) => workstreamId === activeAiWorkstreamId);
    expect(dispatchedAiTasks).toHaveLength(10);
    expect(dispatchedAiTasks.every(({ status, progress }) => status === "todo" && progress === 0)).toBe(true);
    expect(dispatched.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock")).toHaveLength(10);

    const reverseOrder = [...dispatchedAiTasks].reverse();
    reverseOrder.forEach((task, index) => {
      const assigneeSession = sessionForActor(task.assigneeId);
      const reviewerId = getTaskReviewerId(task);
      const reviewerSession = sessionForActor(reviewerId);
      const assigneeContext = createOperationFixtureContext(assigneeSession);
      const reviewerContext = createOperationFixtureContext(reviewerSession);
      const fileId = `customer-demo-deliverable-${task.code}`;

      updateOperationTaskWithContext(assigneeContext, task.id, { status: "in_progress" }, task.assigneeId, assigneeSession.actor);
      addOperationFileWithContext(assigneeContext, {
        id: fileId,
        commandId: task.commandId,
        entityType: "task",
        entityId: task.id,
        name: `${task.code}-${task.title}-成果.txt`,
        mimeType: "text/plain",
        sizeBytes: 1024 + index,
        version: 1,
        uploadedById: task.assigneeId,
        provider: "indexeddb",
        objectPath: fileId,
        createdAt: "2026-08-12T09:00:00.000Z",
      });
      updateOperationTaskWithContext(assigneeContext, task.id, { status: "review" }, task.assigneeId, assigneeSession.actor);

      if (index === 0) {
        updateOperationTaskWithContext(reviewerContext, task.id, { status: "in_progress", reviewNote: "请补充全流程说明", progress: 70 }, reviewerId, reviewerSession.actor);
        updateOperationTaskWithContext(assigneeContext, task.id, { status: "review" }, task.assigneeId, assigneeSession.actor);
      }

      const accepted = updateOperationTaskWithContext(reviewerContext, task.id, { status: "done", reviewNote: "成果符合验收标准" }, reviewerId, reviewerSession.actor);
      expect(accepted.tasks.filter(({ workstreamId, status }) => (
        workstreamId === activeAiWorkstreamId && status === "done"
      ))).toHaveLength(index + 1);
    });

    const completed = readOperationsStateWithContext(executiveContext);
    const completedAiTasks = completed.tasks.filter(({ workstreamId }) => workstreamId === activeAiWorkstreamId);
    const departmentTasks = completed.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock");
    const aiTaskIds = new Set(completedAiTasks.map(({ id }) => id));

    expect(completed.command.status).toBe("accepted");
    expect(completed.workstreams.find(({ id }) => id === activeAiWorkstreamId)?.status).toBe("completed");
    expect(completedAiTasks.every(({ status }) => status === "done")).toBe(true);
    expect(departmentTasks.some(({ status }) => status !== "done")).toBe(true);
    expect(completed.knowledge.filter(({ sourceTaskId }) => sourceTaskId && aiTaskIds.has(sourceTaskId))).toHaveLength(10);
  });

  it("turns a manager return into an employee action with a direct task link and accurate timeline label", () => {
    const sessionFor = (personId: string) => customerDemoSessions.find(
      ({ identity }) => identity.providerSubject === `customer-demo:${personId}`,
    )!;
    const executiveContext = createOperationFixtureContext(sessionFor("demo-executive"));
    const managerContext = createOperationFixtureContext(sessionFor("demo-product-head"));
    const employeeContext = createOperationFixtureContext(sessionFor("demo-engineer"));
    const task = resetOperationsStateWithContext(executiveContext).tasks.find(({ id }) => id === "dept-task-engineer")!;

    updateOperationTaskWithContext(employeeContext, task.id, { status: "accepted" }, "actor-employee", sessionFor("demo-engineer").actor);
    updateOperationTaskWithContext(employeeContext, task.id, { status: "in_progress" }, "actor-employee", sessionFor("demo-engineer").actor);
    addOperationFileWithContext(employeeContext, {
      id: "return-action-file",
      commandId: task.commandId,
      entityType: "task",
      entityId: task.id,
      name: "验收记录.txt",
      mimeType: "text/plain",
      sizeBytes: 512,
      version: 1,
      uploadedById: "actor-employee",
      provider: "indexeddb",
      objectPath: "return-action-file",
      createdAt: "2026-08-12T09:00:00.000Z",
    });
    updateOperationTaskWithContext(employeeContext, task.id, { status: "review" }, "actor-employee", sessionFor("demo-engineer").actor);
    const returned = updateOperationTaskWithContext(managerContext, task.id, { status: "in_progress", reviewNote: "请补充流程截图", progress: 70 }, "actor-manager", sessionFor("demo-product-head").actor);

    expect(returned.events[0]).toMatchObject({
      action: "退回修改",
      actorId: "actor-manager",
    });
    expect(getOperationActionItems(returned, "actor-employee")).toContainEqual(expect.objectContaining({
      kind: "task_return",
      entityId: task.id,
      title: "返工：实现官网核心页面",
      href: "/execution#task-dept-task-engineer",
      priority: "warning",
    }));
  });

  it("enforces assignee submission and designated reviewer approval", () => {
    const initial = readOperationsState();
    saveOperationsState({ ...initial, tasks: initial.tasks.map((task) => task.id === "dept-task-engineer" ? { ...task, dependencyIds: [] } : task) });
    const task = readOperationsState().tasks.find(({ id }) => id === "dept-task-engineer")!;

    expect(() => updateOperationTask(task.id, { status: "accepted" }, "actor-manager")).toThrow("只有任务执行人");
    expect(() => updateOperationTask(task.id, { status: "done" }, "actor-employee")).toThrow("不允许");

    updateOperationTask(task.id, { status: "accepted" }, "actor-employee");
    updateOperationTask(task.id, { status: "in_progress", progress: 20 }, "actor-employee");
    expect(() => updateOperationTask(task.id, { status: "review" }, "actor-employee")).toThrow("必须上传至少一个成果文件");

    addOperationFile({ id: "file-state-machine", commandId: task.commandId, entityType: "task", entityId: task.id, name: "闭环成果.pdf", mimeType: "application/pdf", sizeBytes: 2048, version: 1, uploadedById: "actor-employee", provider: "indexeddb", objectPath: "file-state-machine", createdAt: "2026-08-09T10:00:00.000Z" });
    updateOperationTask(task.id, { status: "review" }, "actor-employee");

    expect(() => updateOperationTask(task.id, { status: "done", reviewNote: "通过" }, "actor-employee")).toThrow("只有指定验收人");
    expect(() => updateOperationTask(task.id, { status: "done", reviewNote: "通过" }, "actor-executive")).toThrow("只有指定验收人");
    expect(() => updateOperationTask(task.id, { status: "done" }, "actor-manager")).toThrow("必须填写验收意见");

    updateOperationTask(task.id, { status: "done", reviewNote: "成果符合验收标准" }, "actor-manager");
    expect(readOperationsState().tasks.find(({ id }) => id === task.id)?.status).toBe("done");
  });

  it("moves leave through manager and HR before it becomes effective", () => {
    submitLeaveRequest({ leaveType: "annual", startDate: "2026-08-20", endDate: "2026-08-20", days: 1, reason: "家庭安排", handover: "T07 交由刘洋跟进" }, "actor-employee");
    const request = readOperationsState().leaveRequests[0];
    expect(request.status).toBe("pending_manager");
    reviewLeaveRequest(request.id, "approve", "actor-manager", "交接清晰");
    expect(readOperationsState().leaveRequests.find(({ id }) => id === request.id)?.status).toBe("pending_hr");
    reviewLeaveRequest(request.id, "approve", "actor-hr", "年假余额校验通过");
    expect(readOperationsState().leaveRequests.find(({ id }) => id === request.id)?.status).toBe("approved");
  });

  it("enforces finance, HR, executive, finance separation for payroll", () => {
    reviewAttendanceCorrection("correction-20260804-01", "approve", "actor-hr", "门禁记录核验通过");
    reviewOvertimeRequest("overtime-20260808-01", "approve", "actor-manager", "业务需要明确");
    reviewOvertimeRequest("overtime-20260808-01", "approve", "actor-hr", "工时记录校验通过");
    lockAttendancePeriod("actor-hr");
    updatePayrollRun("calculated", "actor-finance");
    updatePayrollRun("verified", "actor-hr");
    updatePayrollRun("approved", "actor-executive");
    updatePayrollRun("paid", "actor-finance");
    const run = readOperationsState().payrollRun;
    expect(run.status).toBe("paid");
    expect(run.attendanceLocked).toBe(true);
    expect(run.exceptionCount).toBe(0);
    expect(run.verifiedAt).toBeTruthy();
    expect(run.approvedAt).toBeTruthy();
    expect(run.paidAt).toBeTruthy();
  });

  it("notifies every demo person after payroll is paid and keeps the notice unread", () => {
    reviewAttendanceCorrection("correction-20260804-01", "approve", "actor-hr", "门禁记录核验通过");
    reviewOvertimeRequest("overtime-20260808-01", "approve", "actor-manager", "业务需要明确");
    reviewOvertimeRequest("overtime-20260808-01", "approve", "actor-hr", "工时记录校验通过");
    lockAttendancePeriod("actor-hr");
    updatePayrollRun("calculated", "actor-finance");
    updatePayrollRun("verified", "actor-hr");
    updatePayrollRun("approved", "actor-executive");
    updatePayrollRun("paid", "actor-finance");

    const paidState = readOperationsState();
    customerDemoPeople.forEach(({ actorId }) => {
      expect(getOperationNotifications(paidState, actorId)).toContainEqual(expect.objectContaining({
        id: `payroll-paid:${paidState.payrollRun.id}:${actorId}`,
        title: "2026年08月工资已发放",
        href: "/payroll",
        read: false,
      }));
    });
    expect(getOperationNotifications(paidState, "actor-executive")).not.toContainEqual(expect.objectContaining({
      title: "完成工资发放 · 周倩",
      href: "/tasks",
    }));
  });

  it("adds each payroll stage to the current owner's actionable inbox", () => {
    const initial = readOperationsState();
    const attendanceReady = {
      ...initial,
      attendance: {
        ...initial.attendance,
        corrections: initial.attendance.corrections.map((item) => ({ ...item, status: "approved" as const })),
        overtimeRequests: initial.attendance.overtimeRequests.map((item) => ({ ...item, status: "approved" as const })),
      },
      payrollRun: { ...initial.payrollRun, attendanceLocked: false, exceptionCount: 0 },
    };

    expect(getOperationActionItems(attendanceReady, "actor-hr")).toContainEqual(expect.objectContaining({
      title: "完成考勤封账并生成薪资输入",
      href: "/attendance#monthly-close",
    }));
    expect(getOperationActionItems({ ...attendanceReady, payrollRun: { ...attendanceReady.payrollRun, attendanceLocked: true } }, "actor-finance")).toContainEqual(expect.objectContaining({
      title: "完成 2026-08 薪资核算",
      href: "/payroll#payroll-control",
    }));
    expect(getOperationActionItems({ ...attendanceReady, payrollRun: { ...attendanceReady.payrollRun, attendanceLocked: true, status: "calculated" } }, "actor-hr")).toContainEqual(expect.objectContaining({
      title: "复核 2026-08 工资单",
    }));
    expect(getOperationActionItems({ ...attendanceReady, payrollRun: { ...attendanceReady.payrollRun, attendanceLocked: true, status: "verified" } }, "actor-executive")).toContainEqual(expect.objectContaining({
      title: "批准 2026-08 薪资发放",
    }));
    expect(getOperationActionItems({ ...attendanceReady, payrollRun: { ...attendanceReady.payrollRun, attendanceLocked: true, status: "approved" } }, "actor-finance")).toContainEqual(expect.objectContaining({
      title: "发放 2026-08 工资并归档凭证",
    }));
  });
});
