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

  it("seeds useful work for every non-executive customer demo identity", () => {
    const demoContext = createOperationFixtureContext(customerDemoSessions[0]);
    const state = resetOperationsStateWithContext(demoContext);
    const expectedActorIds = customerDemoPeople
      .filter(({ role }) => role !== "executive")
      .map(({ actorId }) => actorId);

    expect(state.command.title).toBe("30 天完成星云智造 AI 企业工作站试点上线");
    expect(new Set(state.tasks.map(({ assigneeId }) => assigneeId))).toEqual(
      new Set(expectedActorIds),
    );
    expect(state.tasks.filter(({ status }) => status !== "done")).toEqual([
      expect.objectContaining({
        id: "flow-task-02",
        assigneeId: "actor-employee",
        status: "in_progress",
      }),
    ]);
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
    const operationTask = operationState.tasks[0];

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
    const ownerTask = readOperationsState().tasks.find(({ assigneeId, departmentOwnerId }) => assigneeId === departmentOwnerId)!;

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

  it("blocks downstream work until every dependency is done", () => {
    const state = readOperationsState();
    const downstream = state.tasks.find(({ id }) => id === "flow-task-03")!;

    expect(() => updateOperationTask(downstream.id, { status: "in_progress" }, downstream.assigneeId)).toThrow("前置任务尚未完成");
    const legacyViolation = { ...state, tasks: state.tasks.map((task) => task.id === downstream.id ? { ...task, status: "in_progress" as const, progress: 20 } : task) };
    expect(getOperationActionItems(legacyViolation, downstream.assigneeId, new Date("2026-08-09T08:00:00.000Z"))).toContainEqual(expect.objectContaining({ entityId: downstream.id, kind: "task_blocked", priority: "critical" }));

    saveOperationsState({ ...state, tasks: state.tasks.map((task) => task.id === "flow-task-02" ? { ...task, status: "done", progress: 100 } : task) });
    updateOperationTask(downstream.id, { status: "in_progress" }, downstream.assigneeId);
    expect(readOperationsState().tasks.find(({ id }) => id === downstream.id)?.status).toBe("in_progress");
  });

  it("escalates overdue review SLA into the executive decision inbox", () => {
    const escalated = applyTaskEscalations(readOperationsState(), new Date("2026-08-09T08:00:00.000Z"));
    const reviewTask = escalated.tasks.find(({ id }) => id === "flow-task-04")!;
    const actions = getOperationActionItems(escalated, "actor-executive", new Date("2026-08-09T08:00:00.000Z"));

    expect(reviewTask.escalationLevel).toBe("executive");
    expect(actions).toContainEqual(expect.objectContaining({ entityId: reviewTask.id, kind: "executive_decision", priority: "critical" }));
  });

  it("generates role notifications from live actions and persists read receipts", () => {
    const state = readOperationsState();
    const notifications = getOperationNotifications(state, "actor-executive", new Date("2026-08-09T08:00:00.000Z"));
    const critical = notifications.find(({ severity }) => severity === "critical")!;

    expect(critical).toBeTruthy();
    expect(critical.read).toBe(false);
    markOperationNotificationRead(critical.id, "actor-executive");
    expect(getOperationNotifications(readOperationsState(), "actor-executive", new Date("2026-08-09T08:00:00.000Z")).find(({ id }) => id === critical.id)?.read).toBe(true);
  });

  it("builds the leadership weekly brief from the same execution state", () => {
    const initial = readOperationsState();
    const state = { ...initial, tasks: initial.tasks.map((task) => task.id === "flow-task-03" ? { ...task, status: "in_progress" as const } : task) };
    const summary = getOperationWeeklySummary(state, "actor-executive", new Date("2026-08-09T08:00:00.000Z"));

    expect(summary.total).toBe(state.tasks.length);
    expect(summary.completionRate).toBe(Math.round((summary.completed / summary.total) * 100));
    expect(summary.dependencyRisks).toBeGreaterThanOrEqual(1);
    expect(summary.decisions.length).toBeGreaterThanOrEqual(1);
    expect(summary.narrative).toContain("完成率");
  });

  it("requires a deliverable and archives an accepted task as knowledge", () => {
    const task = readOperationsState().tasks.find(({ id }) => id === "flow-task-02")!;
    addOperationFile({ id: "file-test", commandId: task.commandId, entityType: "task", entityId: task.id, name: "验收成果.pdf", mimeType: "application/pdf", sizeBytes: 1024, version: 1, uploadedById: "actor-employee", provider: "indexeddb", objectPath: "file-test", createdAt: "2026-08-08T12:00:00.000Z" });
    updateOperationTask(task.id, { status: "review" }, "actor-employee");
    updateOperationTask(task.id, { status: "done", reviewNote: "符合验收标准" }, "actor-manager");
    const state = readOperationsState();
    expect(state.tasks.find(({ id }) => id === task.id)?.status).toBe("done");
    expect(state.knowledge.find(({ sourceTaskId }) => sourceTaskId === task.id)?.fileIds).toContain("file-test");
  });

  it("enforces assignee submission and designated reviewer approval", () => {
    const initial = readOperationsState();
    saveOperationsState({ ...initial, tasks: initial.tasks.map((task) => task.id === "flow-task-03" ? { ...task, dependencyIds: [] } : task) });
    const task = readOperationsState().tasks.find(({ id }) => id === "flow-task-03")!;

    expect(() => updateOperationTask(task.id, { status: "in_progress" }, "actor-manager")).toThrow("只有任务执行人");
    expect(() => updateOperationTask(task.id, { status: "done" }, "actor-employee")).toThrow("不允许");

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
});
