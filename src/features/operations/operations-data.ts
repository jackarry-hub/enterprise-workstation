import type { DecisionInput, DecisionPlan } from "@/features/decision-workbench/decision-workbench-types";
import { customerDemoActors } from "@/features/demo/customer-demo-data";
import { CUSTOMER_DEMO_STORAGE_NAMESPACE } from "@/features/demo/customer-demo-state";
import type {
  WorkspaceActor,
  WorkspaceRole,
} from "@/features/auth/workspace-session-types";
import {
  requireAuthenticatedActor,
  type OperationFixtureContext,
} from "@/features/operations/operation-actor-compat";
import { calculateProjectProgress } from "@/features/projects/data/project-task-operations";
import { findLocalProject, saveLocalProject } from "@/features/projects/data/mock-project-repository";
import type { ProjectActivity, ProjectDetailData, ProjectTask, TaskStatus } from "@/features/projects/types";
import type {
  AttendanceCorrectionRequest,
  AttendanceIssueType,
  AttendanceOperations,
  AttendanceOvertimeRequest,
  AttendancePolicy,
  AttendancePunchKind,
  AttendancePunchMethod,
  AttendanceReviewStatus,
  CommandStatus,
  KnowledgeEntry,
  LeaveRequest,
  LeaveRequestStatus,
  OperationActionItem,
  OperationFile,
  OperationNotification,
  OperationWeeklySummary,
  OperationsState,
  OperationTask,
  OperationTaskStatus,
  PayrollRunStatus,
  SupportRequest,
  SupportRequestStatus,
} from "@/features/operations/operations-types";

export const OPERATIONS_STORAGE_KEY = "enterprise-workspace.operations.v1";
export const OPERATIONS_CHANGED_EVENT = "enterprise-workspace:operations-changed";

export const operationFixtureActors: readonly WorkspaceActor[] = customerDemoActors;

const BASE_DATE = "2026-08-08T09:00:00.000Z";
const COMMAND_ID = "command-ai-pilot";

function createAttendanceSeed(): AttendanceOperations {
  const policy: AttendancePolicy = {
    id: "attendance-policy-standard",
    name: "总部标准工时制",
    effectiveDate: "2026-01-01",
    workdays: [1, 2, 3, 4, 5],
    workStart: "09:00",
    workEnd: "18:00",
    breakStart: "12:00",
    breakEnd: "13:30",
    dailyHours: 7.5,
    graceMinutes: 5,
    earliestCheckIn: "07:30",
    latestCheckOut: "22:30",
    correctionDeadlineDays: 3,
    overtimeStartsAfter: "18:30",
    overtimeMinimumMinutes: 30,
    clockMethods: ["mobile_gps", "office_wifi", "web"],
    locationName: "上海总部办公区",
    geofenceMeters: 200,
    wifiName: "QXY-Office",
    updatedAt: BASE_DATE,
    updatedById: "actor-hr",
  };
  const employeeIds = ["actor-executive", "actor-manager", "actor-employee", "actor-designer", "actor-finance", "actor-hr"];
  return {
    demoDate: "2026-09-01",
    policy,
    shifts: employeeIds.map((employeeId, index) => ({ id: `shift-20260901-${index + 1}`, employeeId, date: "2026-09-01", dayType: "workday" as const, policyId: policy.id, scheduledStart: policy.workStart, scheduledEnd: policy.workEnd })),
    punches: [
      { id: "punch-manager-in", employeeId: "actor-manager", date: "2026-08-04", kind: "check_in", time: "08:52", occurredAt: "2026-08-04T08:52:00+08:00", method: "office_wifi", locationName: policy.locationName, verified: true },
      { id: "punch-manager-out", employeeId: "actor-manager", date: "2026-08-04", kind: "check_out", time: "18:06", occurredAt: "2026-08-04T18:06:00+08:00", method: "office_wifi", locationName: policy.locationName, verified: true },
      { id: "punch-employee-in", employeeId: "actor-employee", date: "2026-08-04", kind: "check_in", time: "09:14", occurredAt: "2026-08-04T09:14:00+08:00", method: "mobile_gps", locationName: policy.locationName, verified: true },
      { id: "punch-designer-in", employeeId: "actor-designer", date: "2026-08-04", kind: "check_in", time: "08:58", occurredAt: "2026-08-04T08:58:00+08:00", method: "mobile_gps", locationName: policy.locationName, verified: true },
      { id: "punch-designer-out", employeeId: "actor-designer", date: "2026-08-04", kind: "check_out", time: "17:22", occurredAt: "2026-08-04T17:22:00+08:00", method: "mobile_gps", locationName: policy.locationName, verified: true },
    ],
    corrections: [
      { id: "correction-20260804-01", code: "BUKA-20260804-001", employeeId: "actor-employee", managerId: "actor-manager", date: "2026-08-04", issueType: "missing_out", correctedTime: "18:03", reason: "下班打卡时网络异常，门禁离场记录可核验。", attachmentFileIds: [], status: "pending_hr", managerComment: "门禁记录与任务日志一致，同意补卡。", submittedAt: "2026-08-05T01:12:00.000Z", updatedAt: "2026-08-05T02:20:00.000Z" },
      { id: "correction-20260731-02", code: "BUKA-20260731-002", employeeId: "actor-designer", managerId: "actor-manager", date: "2026-07-31", issueType: "early_leave", correctedTime: "18:08", reason: "客户现场签退，已补充会议纪要。", attachmentFileIds: [], status: "approved", managerComment: "客户行程属实。", hrComment: "已按外勤规则修正。", submittedAt: "2026-08-01T01:02:00.000Z", updatedAt: "2026-08-01T06:40:00.000Z" },
    ],
    overtimeRequests: [
      { id: "overtime-20260808-01", code: "OT-20260808-001", employeeId: "actor-employee", managerId: "actor-manager", date: "2026-08-11", startTime: "18:30", endTime: "20:30", hours: 2, reason: "完成 AI 任务分发模块联调与回归验证。", status: "pending_manager", submittedAt: "2026-08-08T12:10:00.000Z", updatedAt: "2026-08-08T12:10:00.000Z" },
    ],
    period: { month: "2026-08", status: "review", scheduledWorkdays: 21, headcount: 128, adjustmentCount: 1 },
  };
}

function createSeedState(): OperationsState {
  const dependencyIdsByTask: Record<string, string[]> = {
    "flow-task-03": ["flow-task-02"],
    "flow-task-05": ["flow-task-01"],
    "flow-task-06": ["flow-task-01"],
    "flow-task-08": ["flow-task-01"],
    "flow-task-09": ["flow-task-08"],
    "flow-task-10": ["flow-task-03"],
  };
  const tasks = ([
    { id: "flow-task-01", code: "T01", commandId: COMMAND_ID, department: "产品研发中心", departmentOwnerId: "actor-manager", assigneeId: "actor-manager", title: "确认试点范围与成功标准", summary: "将领导目标转成范围、指标和可验收口径。", acceptance: "形成一页式试点章程，并由决策人确认。", dueDate: "2026-08-10", priority: "urgent", status: "done", progress: 100, deliverableRequired: false, updatedAt: BASE_DATE },
    { id: "flow-task-02", code: "T06", commandId: COMMAND_ID, department: "产品研发中心", departmentOwnerId: "actor-manager", assigneeId: "actor-employee", title: "实现目标拆解与责任映射", summary: "把决策输入转换为部门目标和个人任务。", acceptance: "一次输入稳定生成部门目标和个人任务，并保留人工确认。", dueDate: "2026-08-21", priority: "urgent", status: "in_progress", progress: 55, deliverableRequired: true, updatedAt: BASE_DATE },
    { id: "flow-task-03", code: "T07", commandId: COMMAND_ID, department: "产品研发中心", departmentOwnerId: "actor-manager", assigneeId: "actor-employee", title: "打通任务执行与结果回流", summary: "让个人执行状态、成果和阻塞实时回到负责人。", acceptance: "负责人可驳回或通过，领导端同步看到结果。", dueDate: "2026-08-27", priority: "urgent", status: "todo", progress: 0, deliverableRequired: true, updatedAt: BASE_DATE },
    { id: "flow-task-04", code: "T04", commandId: COMMAND_ID, department: "设计中心", departmentOwnerId: "actor-manager", assigneeId: "actor-designer", title: "设计三角色工作流原型", summary: "覆盖决策人、负责人和员工执行视角。", acceptance: "原型覆盖输入、拆解、执行、验收和归档。", dueDate: "2026-08-15", priority: "high", status: "review", progress: 90, deliverableRequired: true, updatedAt: BASE_DATE },
    { id: "flow-task-05", code: "T11", commandId: COMMAND_ID, department: "人力资源中心", departmentOwnerId: "actor-hr", assigneeId: "actor-hr", title: "确认角色权限与 RACI", summary: "明确决策人、负责人、执行人和协同人的边界。", acceptance: "核心任务均只有一位最终责任人。", dueDate: "2026-08-15", priority: "high", status: "in_progress", progress: 40, deliverableRequired: true, updatedAt: BASE_DATE },
    { id: "flow-task-06", code: "T14", commandId: COMMAND_ID, department: "财务中心", departmentOwnerId: "actor-finance", assigneeId: "actor-finance", title: "完成试点预算审核与付款", summary: "核验云服务和实施费用，完成审批与付款凭证归集。", acceptance: "预算不超过 30 万元，付款凭证完整可追溯。", dueDate: "2026-08-18", priority: "high", status: "in_progress", progress: 35, deliverableRequired: true, updatedAt: BASE_DATE },
    { id: "flow-task-07", code: "T02", commandId: COMMAND_ID, department: "市场增长中心", departmentOwnerId: "actor-market", assigneeId: "actor-market", title: "完成客户场景调研与启动沟通", summary: "访谈客户关键岗位并建立试点沟通节奏。", acceptance: "客户确认场景清单、参与人和沟通节奏。", dueDate: "2026-08-17", priority: "high", status: "in_progress", progress: 45, deliverableRequired: true, updatedAt: BASE_DATE },
    { id: "flow-task-08", code: "T06", commandId: COMMAND_ID, department: "运营交付中心", departmentOwnerId: "actor-sales", assigneeId: "actor-sales", title: "制定客户试点与上线计划", summary: "确定客户环境、里程碑、联系人和上线检查点。", acceptance: "客户确认试点计划、上线窗口和业务验收负责人。", dueDate: "2026-08-20", priority: "high", status: "todo", progress: 0, deliverableRequired: true, updatedAt: BASE_DATE },
    { id: "flow-task-09", code: "T07", commandId: COMMAND_ID, department: "运营交付中心", departmentOwnerId: "actor-sales", assigneeId: "actor-operations", title: "完成角色培训与反馈回收", summary: "组织客户关键用户完成一次全流程演练。", acceptance: "完成三类角色培训并形成问题关闭清单。", dueDate: "2026-08-28", priority: "high", status: "todo", progress: 0, deliverableRequired: true, updatedAt: BASE_DATE },
    { id: "flow-task-10", code: "T05", commandId: COMMAND_ID, department: "产品研发中心", departmentOwnerId: "actor-manager", assigneeId: "actor-qa", title: "完成关键流程回归测试", summary: "验证切换、下发、执行、退回、验收和重置。", acceptance: "测试报告覆盖 10 个身份和完整闭环，阻断级问题为零。", dueDate: "2026-08-25", priority: "urgent", status: "todo", progress: 0, deliverableRequired: true, updatedAt: BASE_DATE },
  ] as const).map((task): OperationTask => ({
    ...task,
    dependencyIds: dependencyIdsByTask[task.id] ?? [],
    reviewDueAt: task.id === "flow-task-04" ? "2026-08-08T12:00:00.000Z" : undefined,
    escalationLevel: "none",
  }));

  return {
    version: 1,
    command: { id: COMMAND_ID, title: "30 天完成星云智造 AI 企业工作站试点上线", summary: "让领导目标自动分发到部门和个人，并形成可验收、可归档的执行闭环。", ownerId: "actor-executive", status: "executing", deadline: "2026-09-07", budgetWan: 30, createdAt: BASE_DATE, updatedAt: BASE_DATE },
    tasks,
    supportRequests: [
      { id: "support-finance-01", commandId: COMMAND_ID, sourceTaskId: "flow-task-06", type: "finance", title: "试点云资源采购预算", description: "用于模型调用、对象存储和试点环境，预算 8 万元。", requesterId: "actor-manager", handlerId: "actor-finance", amountWan: 8, status: "pending", updatedAt: BASE_DATE },
      { id: "support-hr-01", commandId: COMMAND_ID, sourceTaskId: "flow-task-03", type: "staffing", title: "调配一名测试工程师参与试点", description: "预计投入两周，负责关键流程回归与验收记录。", requesterId: "actor-manager", handlerId: "actor-hr", status: "approved", result: "已锁定质量中心郭敏，等待确认到岗时间。", updatedAt: BASE_DATE },
      { id: "support-training-01", commandId: COMMAND_ID, sourceTaskId: "flow-task-05", type: "training", title: "三角色使用培训", description: "组织决策人、负责人、员工完成一次全流程演练。", requesterId: "actor-hr", handlerId: "actor-hr", status: "in_progress", updatedAt: BASE_DATE },
    ],
    files: [],
    knowledge: [
      { id: "knowledge-seed-01", commandId: COMMAND_ID, sourceTaskId: "flow-task-01", title: "企业 AI 工作站试点章程", summary: "记录试点范围、成功指标、角色边界和不做事项。", category: "流程制度", tags: ["AI试点", "决策章程"], fileIds: [], status: "published", createdById: "actor-manager", updatedAt: BASE_DATE },
    ],
    leaveRequests: [
      { id: "leave-202608-01", code: "LEAVE-20260808-001", employeeId: "actor-employee", managerId: "actor-manager", leaveType: "annual", startDate: "2026-08-17", endDate: "2026-08-17", days: 1, reason: "家庭事务安排", handover: "T07 任务由刘洋临时跟进，相关文档已同步。", status: "pending_manager", submittedAt: "2026-08-08T11:00:00.000Z", updatedAt: "2026-08-08T11:00:00.000Z" },
      { id: "leave-202608-02", code: "LEAVE-20260804-002", employeeId: "actor-manager", managerId: "actor-executive", leaveType: "annual", startDate: "2026-08-06", endDate: "2026-08-08", days: 2.5, reason: "家庭事务安排", handover: "试点例会由王芳主持，紧急决策通过工作站提交。", status: "approved", managerComment: "工作已完成交接，同意。", hrComment: "年假余额充足，已同步考勤。", submittedAt: "2026-08-04T09:18:00.000Z", updatedAt: "2026-08-04T11:20:00.000Z" },
    ],
    attendance: createAttendanceSeed(),
    payrollRun: { id: "payroll-2026-08", month: "2026-08", status: "draft", headcount: 128, grossAmount: 1864200, deductionAmount: 214860, netAmount: 1649340, attendanceLocked: false, exceptionCount: 2, updatedAt: "2026-08-08T08:30:00.000Z" },
    events: [
      { id: "event-seed-03", commandId: COMMAND_ID, actorId: "actor-manager", action: "分配任务", detail: "将“目标拆解与责任映射”分配给陈晨。", createdAt: "2026-08-08T10:30:00.000Z" },
      { id: "event-seed-02", commandId: COMMAND_ID, actorId: "actor-executive", action: "确认下发", detail: "确认 AI 拆解方案并下发到 7 个部门。", createdAt: "2026-08-08T09:20:00.000Z" },
      { id: "event-seed-01", commandId: COMMAND_ID, actorId: "actor-executive", action: "下达命令", detail: "要求 30 天内完成企业 AI 工作站试点。", createdAt: BASE_DATE },
    ],
    notificationReads: {},
  };
}

function createSeedStateForContext(context: OperationFixtureContext): OperationsState {
  const seed = createSeedState();
  if (context.storageNamespace !== CUSTOMER_DEMO_STORAGE_NAMESPACE) return seed;

  return {
    ...seed,
    tasks: seed.tasks.map((task) => task.id === "flow-task-02" ? task : {
      ...task,
      dependencyIds: task.id === "flow-task-03" ? [] : task.dependencyIds,
      status: "done",
      progress: 100,
      blocker: undefined,
      reviewDueAt: undefined,
      blockerDueAt: undefined,
      escalationLevel: "none",
      escalatedAt: undefined,
    }),
    supportRequests: seed.supportRequests.map((request) => ({
      ...request,
      status: "completed",
      result: request.result ?? "演示准备已完成，相关凭证与记录已归档。",
    })),
  };
}

function createSanitizedOperationsState(): OperationsState {
  const emptyTimestamp = "1970-01-01T00:00:00.000Z";
  return {
    version: 1,
    command: {
      id: "",
      title: "",
      summary: "",
      ownerId: "",
      status: "executing",
      deadline: "",
      budgetWan: 0,
      createdAt: emptyTimestamp,
      updatedAt: emptyTimestamp,
    },
    tasks: [],
    supportRequests: [],
    files: [],
    knowledge: [],
    leaveRequests: [],
    attendance: {
      demoDate: "",
      policy: {
        id: "",
        name: "",
        effectiveDate: "",
        workdays: [],
        workStart: "09:00",
        workEnd: "18:00",
        breakStart: "12:00",
        breakEnd: "13:00",
        dailyHours: 0,
        graceMinutes: 0,
        earliestCheckIn: "",
        latestCheckOut: "",
        correctionDeadlineDays: 0,
        overtimeStartsAfter: "18:00",
        overtimeMinimumMinutes: 0,
        clockMethods: [],
        locationName: "",
        geofenceMeters: 0,
        wifiName: "",
        updatedAt: emptyTimestamp,
        updatedById: "",
      },
      shifts: [],
      punches: [],
      corrections: [],
      overtimeRequests: [],
      period: {
        month: "",
        status: "open",
        scheduledWorkdays: 0,
        headcount: 0,
        adjustmentCount: 0,
      },
    },
    payrollRun: {
      id: "",
      month: "",
      status: "draft",
      headcount: 0,
      grossAmount: 0,
      deductionAmount: 0,
      netAmount: 0,
      attendanceLocked: false,
      exceptionCount: 0,
      updatedAt: emptyTimestamp,
    },
    events: [],
    notificationReads: {},
  };
}

export function createInitialOperationsState(context: OperationFixtureContext) {
  return context.actor ? createSeedStateForContext(context) : createSanitizedOperationsState();
}

function operationStatusFromProject(status: TaskStatus): OperationTaskStatus {
  if (status === "done") return "done";
  if (status === "in_review") return "review";
  if (status === "blocked") return "blocked";
  if (status === "in_progress") return "in_progress";
  return "todo";
}

function projectStatusFromOperation(status: OperationTaskStatus): TaskStatus {
  if (status === "done") return "done";
  if (status === "review") return "in_review";
  if (status === "blocked") return "blocked";
  if (status === "in_progress") return "in_progress";
  return "todo";
}

function requireActorByMemberId(memberId: string, context: string) {
  const actor = operationFixtureActors.find((candidate) => candidate.memberId === memberId);
  if (!actor) throw new Error(`${context}未配置工作站账号：${memberId}`);
  return actor;
}

function departmentOwnerFor(department: string, assignee: WorkspaceActor) {
  if (["department_head", "hr", "finance"].includes(assignee.role)) return assignee;
  const owner = operationFixtureActors.find((candidate) => candidate.department === department && ["department_head", "hr", "finance"].includes(candidate.role));
  if (!owner) throw new Error(`${department}未配置部门负责人账号`);
  return owner;
}

function acceptanceFromDescription(description: string) {
  return description.split("\n").find((line) => line.startsWith("验收标准："))?.replace("验收标准：", "").trim()
    || "按任务说明完成交付，并由负责人确认质量与结果。";
}

function dependencyIdsFromDescription(task: ProjectTask, detail: ProjectDetailData) {
  const value = task.description.split("\n").find((line) => line.startsWith("前置依赖："))?.replace("前置依赖：", "").trim();
  if (!value || value === "无") return [];
  const taskIds = new Set(detail.tasks.map(({ id }) => id));
  return value.split(/[、,，\s]+/).map((code) => `${detail.project.id}-${code}`).filter((id) => taskIds.has(id));
}

function operationTaskFromProject(
  task: ProjectTask,
  detail: ProjectDetailData,
  commandId: string,
  previous?: OperationTask,
): OperationTask {
  if (!task.assigneeId) throw new Error(`任务“${task.title}”尚未指定唯一负责人`);
  const assignee = requireActorByMemberId(task.assigneeId, `任务“${task.title}”`);
  const membership = detail.members.find(({ member }) => member.id === task.assigneeId)?.member;
  const department = membership?.department || assignee.department;
  const departmentOwner = departmentOwnerFor(department, assignee);
  return {
    id: task.id,
    code: previous?.code ?? task.id.replace(`${detail.project.id}-`, ""),
    commandId,
    department,
    departmentOwnerId: departmentOwner.id,
    assigneeId: assignee.id,
    title: task.title,
    summary: task.description,
    acceptance: previous?.acceptance ?? acceptanceFromDescription(task.description),
    dueDate: task.dueDate ?? detail.project.dueDate,
    priority: task.priority === "low" ? "medium" : task.priority,
    status: operationStatusFromProject(task.status),
    progress: task.progress,
    deliverableRequired: previous?.deliverableRequired ?? true,
    dependencyIds: previous?.dependencyIds?.length ? previous.dependencyIds : dependencyIdsFromDescription(task, detail),
    blocker: task.status === "blocked" ? previous?.blocker ?? "项目任务已标记阻塞" : undefined,
    reviewNote: previous?.reviewNote,
    reviewDueAt: previous?.reviewDueAt,
    blockerDueAt: previous?.blockerDueAt,
    escalationLevel: previous?.escalationLevel ?? "none",
    escalatedAt: previous?.escalatedAt,
    updatedAt: task.updatedAt,
  };
}

function hydrateOperationsFromProject(context: OperationFixtureContext, state: OperationsState): OperationsState {
  const projectId = state.command.projectId;
  if (!projectId) return state;
  const detail = findLocalProject(context, projectId);
  if (!detail) return state;
  const previousById = new Map(state.tasks.map((task) => [task.id, task]));
  const tasks = detail.tasks
    .filter(({ status }) => status !== "cancelled")
    .map((task) => operationTaskFromProject(task, detail, state.command.id, previousById.get(task.id)));
  return {
    ...state,
    command: {
      ...state.command,
      title: detail.project.name.startsWith("AI 决策专项 ·") ? state.command.title : detail.project.name,
      deadline: detail.project.dueDate,
      updatedAt: detail.project.updatedAt,
    },
    tasks,
  };
}

function saveOperationTaskToProject(
  context: OperationFixtureContext,
  state: OperationsState,
  task: OperationTask,
  auditActor: WorkspaceActor,
) {
  const projectId = state.command.projectId;
  if (!projectId) return;
  const detail = findLocalProject(context, projectId);
  if (!detail) return;
  const projectTask = detail.tasks.find(({ id }) => id === task.id);
  if (!projectTask) throw new Error(`项目主数据中未找到任务“${task.title}”`);
  const assignee = getActor(task.assigneeId);
  const timestamp = task.updatedAt;
  const tasks = detail.tasks.map((item): ProjectTask => item.id === task.id ? {
    ...item,
    assigneeId: assignee.memberId,
    status: projectStatusFromOperation(task.status),
    progress: task.progress,
    completedAt: task.status === "done" ? timestamp : undefined,
    updatedAt: timestamp,
  } : item);
  const activity: ProjectActivity = {
    id: `activity-unified-${Date.now()}`,
    organizationId: detail.project.organizationId,
    projectId,
    userId: auditActor.id,
    actionType: "task_updated",
    content: `${auditActor.name}在工作台更新了任务“${task.title}”，状态已同步到项目与决策中心。`,
    createdAt: timestamp,
  };
  saveLocalProject(context, {
    ...detail,
    project: { ...detail.project, progress: calculateProjectProgress(tasks), updatedAt: timestamp },
    tasks,
    activities: [activity, ...detail.activities],
  });
}

export function applyTaskEscalations(state: OperationsState, now = new Date()): OperationsState {
  const nowValue = now.valueOf();
  let changed = false;
  const tasks = state.tasks.map((task): OperationTask => {
    const normalized = {
      ...task,
      dependencyIds: task.dependencyIds ?? [],
      escalationLevel: task.escalationLevel ?? "none" as const,
    };
    const slaDueAt = normalized.status === "blocked" ? normalized.blockerDueAt : normalized.status === "review" ? normalized.reviewDueAt : undefined;
    if (!slaDueAt || new Date(slaDueAt).valueOf() > nowValue || normalized.escalationLevel === "executive") return normalized;
    changed = true;
    return { ...normalized, escalationLevel: "executive", escalatedAt: normalized.escalatedAt ?? now.toISOString() };
  });
  return changed ? { ...state, tasks } : { ...state, tasks };
}

export function getOperationsStorageKey(context: OperationFixtureContext) {
  return context.storageNamespace
    ? `${OPERATIONS_STORAGE_KEY}:${context.storageNamespace}`
    : null;
}

function requireFixtureActor(
  context: OperationFixtureContext,
  actorId?: string,
) {
  if (!context.actor || !context.storageNamespace) {
    throw new Error("当前真实身份未绑定本地业务夹具");
  }
  if (actorId !== undefined && actorId !== context.actor.id) {
    throw new Error("当前真实身份无权代表其他夹具身份执行写入");
  }
  return context.actor;
}

export function readOperationsState(
  context: OperationFixtureContext,
  storage?: Pick<Storage, "getItem" | "setItem">,
): OperationsState {
  if (!context.actor) return createSanitizedOperationsState();
  const storageKey = getOperationsStorageKey(context)!;
  const resolved = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!resolved) return createSeedStateForContext(context);
  try {
    const parsed = JSON.parse(resolved.getItem(storageKey) ?? "null") as OperationsState | null;
    if (parsed?.version === 1 && parsed.command && Array.isArray(parsed.tasks)) {
      const seed = createSeedStateForContext(context);
      const normalized: OperationsState = { ...parsed, tasks: parsed.tasks.map((task) => ({ ...task, dependencyIds: task.dependencyIds ?? [], escalationLevel: task.escalationLevel ?? "none" })), leaveRequests: parsed.leaveRequests ?? seed.leaveRequests, attendance: parsed.attendance ?? seed.attendance, payrollRun: parsed.payrollRun ?? seed.payrollRun, notificationReads: parsed.notificationReads ?? {} };
      if (!parsed.leaveRequests || !parsed.attendance || !parsed.payrollRun || !parsed.notificationReads) resolved.setItem(storageKey, JSON.stringify(normalized));
      return applyTaskEscalations(hydrateOperationsFromProject(context, normalized));
    }
  } catch {
    // Corrupt demo data is replaced with a deterministic seed below.
  }
  const seed = createSeedStateForContext(context);
  resolved.setItem(storageKey, JSON.stringify(seed));
  return applyTaskEscalations(hydrateOperationsFromProject(context, seed));
}

export function saveOperationsState(
  context: OperationFixtureContext,
  state: OperationsState,
  storage?: Pick<Storage, "setItem">,
) {
  requireFixtureActor(context);
  const storageKey = getOperationsStorageKey(context)!;
  const resolved = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  resolved?.setItem(storageKey, JSON.stringify(state));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPERATIONS_CHANGED_EVENT));
  return state;
}

export function resetOperationsState(
  context: OperationFixtureContext,
  storage?: Pick<Storage, "setItem" | "removeItem">,
) {
  requireFixtureActor(context);
  const storageKey = getOperationsStorageKey(context)!;
  const resolved = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  resolved?.removeItem(storageKey);
  return saveOperationsState(context, createSeedStateForContext(context), resolved);
}

export function getActor(actorId: string) {
  return operationFixtureActors.find(({ id }) => id === actorId) ?? operationFixtureActors[0];
}

export function getActorByMemberId(memberId: string) {
  return operationFixtureActors.find((actor) => actor.memberId === memberId);
}

export function getRoleActor(role: WorkspaceRole) {
  return operationFixtureActors.find((actor) => actor.role === role) ?? operationFixtureActors[0];
}

function nowIso() {
  return new Date().toISOString();
}

function afterHours(timestamp: string, hours: number) {
  return new Date(new Date(timestamp).valueOf() + hours * 3_600_000).toISOString();
}

function requireActorById(actorId: string) {
  const actor = operationFixtureActors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new Error("当前账号未配置工作站身份");
  return actor;
}

export function getTaskReviewerId(task: OperationTask) {
  return task.assigneeId === task.departmentOwnerId ? "actor-executive" : task.departmentOwnerId;
}

export function getOperationActionItems(
  state: OperationsState,
  actorId: string,
  now = new Date(),
): OperationActionItem[] {
  const actor = requireActorById(actorId);
  const nowValue = now.valueOf();
  const today = now.toISOString().slice(0, 10);
  const items: OperationActionItem[] = [];
  const add = (item: OperationActionItem) => items.push(item);

  state.tasks.forEach((task) => {
    const isOverdue = task.status !== "done" && task.dueDate < today;
    const slaDueAt = task.status === "review" ? task.reviewDueAt : task.status === "blocked" ? task.blockerDueAt : undefined;
    const slaOverdue = Boolean(slaDueAt && new Date(slaDueAt).valueOf() <= nowValue);
    const taskHref = `${actor.landingPath}#task-${task.id}`;

    if (task.status === "review" && getTaskReviewerId(task) === actor.id) {
      add({ id: `review-${task.id}`, kind: "task_review", entityId: task.id, title: `验收：${task.title}`, description: `执行人 ${getActor(task.assigneeId).name} 已提交成果，等待验收。`, priority: slaOverdue ? "critical" : "warning", dueAt: task.reviewDueAt, href: taskHref });
      return;
    }

    if (task.status === "blocked" && task.departmentOwnerId === actor.id) {
      add({ id: `blocked-${task.id}`, kind: "task_blocked", entityId: task.id, title: `解除阻塞：${task.title}`, description: task.blocker ?? "执行人已上报阻塞。", priority: slaOverdue ? "critical" : "warning", dueAt: task.blockerDueAt, href: taskHref });
      return;
    }

    if (task.assigneeId === actor.id && task.status === "in_progress" && task.reviewNote) {
      add({ id: `return-${task.id}`, kind: "task_return", entityId: task.id, title: `返工：${task.title}`, description: `负责人已退回修改：${task.reviewNote}`, priority: "warning", dueAt: task.dueDate, href: taskHref });
      return;
    }

    if (task.assigneeId === actor.id && task.status === "todo") {
      add({ id: `ready-${task.id}`, kind: "task_ready", entityId: task.id, title: `可开始：${task.title}`, description: "这是你的独立任务，可直接开始并在完成后提交验收。", priority: isOverdue ? "critical" : "normal", dueAt: task.dueDate, href: taskHref });
    } else if (task.assigneeId === actor.id && isOverdue) {
      add({ id: `overdue-${task.id}`, kind: "task_overdue", entityId: task.id, title: `已逾期：${task.title}`, description: `截止日期为 ${task.dueDate}，请立即更新进度或上报阻塞。`, priority: "critical", dueAt: task.dueDate, href: taskHref });
    }
  });

  state.supportRequests.forEach((request) => {
    if (request.handlerId !== actor.id || ["completed", "rejected"].includes(request.status)) return;
    add({ id: `support-${request.id}`, kind: "support", entityId: request.id, title: request.title, description: request.description, priority: request.status === "pending" ? "warning" : "normal", href: `${actor.landingPath}#support-${request.id}` });
  });

  state.leaveRequests.forEach((request) => {
    const canReview = request.status === "pending_manager" ? request.managerId === actor.id : request.status === "pending_hr" && actor.role === "hr";
    if (canReview) add({ id: `leave-${request.id}`, kind: "approval", entityId: request.id, title: `请假审批：${getActor(request.employeeId).name}`, description: `${request.days} 天 · ${request.startDate} 至 ${request.endDate}`, priority: "warning", href: `/leave#leave-${request.id}` });
  });

  [...state.attendance.corrections, ...state.attendance.overtimeRequests].forEach((request) => {
    const canReview = request.status === "pending_manager" ? request.managerId === actor.id : request.status === "pending_hr" && actor.role === "hr";
    if (canReview) add({ id: `attendance-${request.id}`, kind: "approval", entityId: request.id, title: `考勤审批：${getActor(request.employeeId).name}`, description: `${request.code} · ${request.date}`, priority: "warning", href: `/attendance#attendance-${request.id}` });
  });

  const priorityOrder = { critical: 0, warning: 1, normal: 2 } as const;
  return items.sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority] || (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999"));
}

function notificationCategory(kind: OperationActionItem["kind"]): OperationNotification["category"] {
  if (kind === "approval") return "approval";
  if (kind === "support") return "collaboration";
  return "task";
}

function actionCreatedAt(state: OperationsState, item: OperationActionItem) {
  return state.tasks.find(({ id }) => id === item.entityId)?.updatedAt
    ?? state.supportRequests.find(({ id }) => id === item.entityId)?.updatedAt
    ?? state.leaveRequests.find(({ id }) => id === item.entityId)?.updatedAt
    ?? state.attendance.corrections.find(({ id }) => id === item.entityId)?.updatedAt
    ?? state.attendance.overtimeRequests.find(({ id }) => id === item.entityId)?.updatedAt
    ?? state.command.updatedAt;
}

function eventDestination(action: string) {
  if (/请假/.test(action)) return "/leave";
  if (/考勤|补卡|加班/.test(action)) return "/attendance";
  if (/薪资|封账/.test(action)) return "/payroll";
  if (/预算|财务|协同/.test(action)) return "/approvals";
  return "/tasks";
}

function isEventRelevant(state: OperationsState, actor: WorkspaceActor, item: OperationsState["events"][number]) {
  if (item.actorId === actor.id) return false;
  if (actor.role === "executive") return true;
  if (item.detail.includes(actor.name)) return true;
  if (actor.role === "finance") return /预算|财务|薪资|封账|采购/.test(`${item.action}${item.detail}`);
  if (actor.role === "hr") return /人事|人员|请假|考勤|补卡|加班|薪资/.test(`${item.action}${item.detail}`);
  const visibleTasks = state.tasks.filter((task) => task.assigneeId === actor.id || task.departmentOwnerId === actor.id);
  if (visibleTasks.some((task) => item.detail.includes(task.title))) return true;
  if (actor.role === "department_head") return operationFixtureActors.find(({ id }) => id === item.actorId)?.department === actor.department;
  return false;
}

export function getOperationNotifications(
  state: OperationsState,
  actorId: string,
  now = new Date(),
): OperationNotification[] {
  const actor = requireActorById(actorId);
  const reads = new Set(state.notificationReads?.[actorId] ?? []);
  const actionNotifications = getOperationActionItems(state, actorId, now).map<OperationNotification>((item) => ({
    id: `action:${item.id}`,
    actorId,
    title: item.title,
    description: item.description,
    severity: item.priority === "normal" ? "info" : item.priority,
    category: notificationCategory(item.kind),
    href: item.href,
    createdAt: actionCreatedAt(state, item),
    read: reads.has(`action:${item.id}`),
  }));
  const escalationNotifications = actor.role === "executive"
    ? state.tasks.filter(({ escalationLevel }) => escalationLevel === "executive").map<OperationNotification>((task) => ({
      id: `escalation:${task.id}`,
      actorId,
      title: `升级提醒：${task.title}`,
      description: "该事项已超过处理时限，请关注责任人协调结果。",
      severity: "critical",
      category: "task",
      href: "/dashboard#customer-demo-closure",
      createdAt: task.escalatedAt ?? task.updatedAt,
      read: reads.has(`escalation:${task.id}`),
    }))
    : [];
  const eventNotifications = state.events
    .filter((item) => isEventRelevant(state, actor, item))
    .slice(0, 12)
    .map<OperationNotification>((item) => ({
      id: `event:${item.id}`,
      actorId,
      title: `${item.action} · ${item.actorName ?? getActor(item.actorId).name}`,
      description: item.detail,
      severity: "info",
      category: "system",
      href: eventDestination(item.action),
      createdAt: item.createdAt,
      read: reads.has(`event:${item.id}`),
    }));
  const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
  return [...actionNotifications, ...escalationNotifications, ...eventNotifications].sort((left, right) => Number(left.read) - Number(right.read) || severityOrder[left.severity] - severityOrder[right.severity] || right.createdAt.localeCompare(left.createdAt));
}

export function markOperationNotificationRead(context: OperationFixtureContext, notificationId: string, actorId: string) {
  requireFixtureActor(context, actorId);
  requireActorById(actorId);
  const state = readOperationsState(context);
  const current = state.notificationReads?.[actorId] ?? [];
  if (current.includes(notificationId)) return state;
  return saveOperationsState(context, { ...state, notificationReads: { ...state.notificationReads, [actorId]: [...current, notificationId] } });
}

export function markAllOperationNotificationsRead(context: OperationFixtureContext, actorId: string) {
  requireFixtureActor(context, actorId);
  requireActorById(actorId);
  const state = readOperationsState(context);
  const ids = getOperationNotifications(state, actorId).map(({ id }) => id);
  return saveOperationsState(context, { ...state, notificationReads: { ...state.notificationReads, [actorId]: Array.from(new Set([...(state.notificationReads?.[actorId] ?? []), ...ids])) } });
}

export function getOperationWeeklySummary(
  state: OperationsState,
  actorId: string,
  now = new Date(),
): OperationWeeklySummary {
  const actor = requireActorById(actorId);
  const today = now.toISOString().slice(0, 10);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const tasks = state.tasks.filter((task) => actor.role === "executive" || (actor.role === "department_head" ? task.departmentOwnerId === actor.id : task.assigneeId === actor.id));
  const taskIds = new Set(tasks.map(({ id }) => id));
  const completed = tasks.filter(({ status }) => status === "done").length;
  const dependencyRisks = 0;
  const overdue = tasks.filter(({ dueDate, status }) => status !== "done" && dueDate < today).length;
  const openSupport = state.supportRequests.filter((request) => taskIds.has(request.sourceTaskId) && !["completed", "rejected"].includes(request.status)).length;
  const actions = getOperationActionItems(state, actorId, now);
  const escalatedDecisions = actor.role === "executive"
    ? tasks.filter(({ escalationLevel }) => escalationLevel === "executive").map(({ title }) => `需协调：${title}`)
    : [];
  const decisions = [...escalatedDecisions, ...actions.filter(({ priority }) => priority === "critical").map(({ title }) => title)].slice(0, 3);
  const nextFocus = actions.filter(({ priority }) => priority !== "critical").slice(0, 3).map(({ title }) => title);
  const highlights = tasks.filter((task) => task.status === "done" && new Date(task.updatedAt) >= weekStart).slice(0, 3).map(({ title }) => title);
  const scopeLabel = actor.role === "executive" ? "公司专项" : actor.role === "department_head" ? actor.department : `${actor.name}个人任务`;
  const completionRate = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const blocked = tasks.filter(({ status }) => status === "blocked").length;
  const reviewing = tasks.filter(({ status }) => status === "review").length;
  return {
    actorId,
    scopeLabel,
    periodLabel: `${weekStart.toISOString().slice(0, 10)} 至 ${weekEnd.toISOString().slice(0, 10)}`,
    total: tasks.length,
    completed,
    completionRate,
    inProgress: tasks.filter(({ status }) => status === "in_progress").length,
    reviewing,
    blocked,
    overdue,
    dependencyRisks,
    openSupport,
    pendingApprovals: actions.filter(({ kind }) => kind === "approval" || kind === "task_review").length,
    narrative: `${scopeLabel}共 ${tasks.length} 项任务，已完成 ${completed} 项，完成率 ${completionRate}%；当前 ${blocked} 项阻塞、${reviewing} 项待验收、${overdue} 项逾期。`,
    highlights,
    decisions,
    nextFocus: nextFocus.length ? nextFocus : tasks.filter(({ status }) => status === "in_progress").slice(0, 3).map(({ title }) => title),
  };
}

type OperationTaskPatch = Partial<Pick<OperationTask, "assigneeId" | "status" | "progress" | "blocker" | "reviewNote">>;

function assertTaskMutationAllowed(
  state: OperationsState,
  before: OperationTask,
  patch: OperationTaskPatch,
  actor: WorkspaceActor,
) {
  if (before.status === "done") throw new Error("已验收任务不可再修改");

  const changesAssignee = Boolean(patch.assigneeId && patch.assigneeId !== before.assigneeId);
  if (changesAssignee) {
    if (actor.id !== before.departmentOwnerId) throw new Error("只有归口负责人可以调整执行人");
    if (["review", "done"].includes(before.status)) throw new Error("验收阶段不可更换执行人");
    const nextAssignee = requireActorById(patch.assigneeId!);
    if (nextAssignee.department !== before.department) throw new Error("执行人必须属于任务归口部门");
  }

  if (!patch.status || patch.status === before.status) {
    if (!changesAssignee && patch.progress !== undefined && actor.id !== before.assigneeId) {
      throw new Error("只有执行人可以更新任务进度");
    }
    return;
  }

  const isAssignee = actor.id === before.assigneeId;
  const isReviewer = actor.id === getTaskReviewerId(before);
  const transition = `${before.status}->${patch.status}`;
  const assigneeTransitions = new Set(["todo->in_progress", "in_progress->blocked", "in_progress->review"]);
  const reviewerTransitions = new Set(["blocked->in_progress", "review->in_progress", "review->done"]);

  if (assigneeTransitions.has(transition) && !isAssignee) throw new Error("只有任务执行人可以执行或提交成果");
  if (reviewerTransitions.has(transition) && !isReviewer) throw new Error("只有指定验收人可以处理该节点");
  if (!assigneeTransitions.has(transition) && !reviewerTransitions.has(transition)) {
    throw new Error(`不允许从“${before.status}”直接变更为“${patch.status}”`);
  }

  const taskFiles = state.files.filter(({ entityType, entityId }) => entityType === "task" && entityId === before.id);
  if (patch.status === "blocked" && !patch.blocker?.trim()) throw new Error("上报阻塞时必须说明原因");
  if (patch.status === "review" && before.deliverableRequired && taskFiles.length === 0) {
    throw new Error("提交验收前必须上传至少一个成果文件");
  }
  if (["in_progress", "done"].includes(patch.status) && before.status === "review" && !patch.reviewNote?.trim()) {
    throw new Error("验收通过或退回时必须填写验收意见");
  }
  if (patch.status === "done" && before.deliverableRequired && taskFiles.length === 0) {
    throw new Error("没有成果文件的任务不能验收通过");
  }
}

function event(actorId: string, action: string, detail: string, commandId = COMMAND_ID, actorName?: string) {
  return { id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, commandId, actorId, actorName, action, detail, createdAt: nowIso() };
}

export function updateOperationTask(
  context: OperationFixtureContext,
  taskId: string,
  patch: OperationTaskPatch,
  actorId: string,
  auditActor: WorkspaceActor,
) {
  requireFixtureActor(context, actorId);
  requireAuthenticatedActor(context, auditActor);
  const state = readOperationsState(context);
  const before = state.tasks.find(({ id }) => id === taskId);
  if (!before) throw new Error("未找到任务");
  const actor = requireActorById(actorId);
  assertTaskMutationAllowed(state, before, patch, actor);
  const updatedAt = nowIso();
  const changesAssignee = Boolean(patch.assigneeId && patch.assigneeId !== before.assigneeId);
  const task = {
    ...before,
    ...patch,
    status: changesAssignee ? "todo" as const : patch.status ?? before.status,
    progress: changesAssignee ? 0 : patch.progress ?? before.progress,
    blocker: changesAssignee ? undefined : patch.blocker ?? before.blocker,
    reviewNote: changesAssignee ? undefined : patch.reviewNote ?? before.reviewNote,
    updatedAt,
  };
  if (task.status === "done") task.progress = 100;
  if (task.status === "review" && task.progress < 90) task.progress = 90;
  if (task.status === "in_progress" && before.status === "todo" && task.progress < 20) task.progress = 20;
  if (task.status !== "blocked") task.blocker = undefined;
  if (task.status === "blocked") {
    task.blockerDueAt = afterHours(updatedAt, 4);
    task.reviewDueAt = undefined;
    task.escalationLevel = "manager";
    task.escalatedAt = undefined;
  } else if (task.status === "review") {
    task.reviewDueAt = afterHours(updatedAt, 24);
    task.blockerDueAt = undefined;
    task.escalationLevel = "none";
    task.escalatedAt = undefined;
  } else {
    task.reviewDueAt = undefined;
    task.blockerDueAt = undefined;
    task.escalationLevel = "none";
    task.escalatedAt = undefined;
  }
  const labels: Record<OperationTaskStatus, string> = { todo: "退回待执行", in_progress: "开始执行", blocked: "标记阻塞", review: "提交验收", done: "通过验收" };
  const transition = `${before.status}->${task.status}`;
  const actionLabel = transition === "review->in_progress" ? "退回修改" : labels[task.status];
  const nextKnowledge = task.status === "done"
    ? upsertKnowledgeForTask(state.knowledge, task, actorId).map((entry) => entry.sourceTaskId === task.id ? { ...entry, fileIds: state.files.filter((file) => file.entityType === "task" && file.entityId === task.id).map(({ id }) => id) } : entry)
    : state.knowledge;
  const saved = saveOperationsState(context, {
    ...state,
    command: { ...state.command, updatedAt: task.updatedAt },
    tasks: state.tasks.map((item) => item.id === taskId ? task : item),
    knowledge: nextKnowledge,
    events: [event(actorId, actionLabel, `${actor.name}将“${task.title}”${actionLabel}。`), ...state.events],
  });
  saveOperationTaskToProject(context, saved, task, auditActor);
  return saved;
}

export function syncProjectTasksToOperations(
  context: OperationFixtureContext,
  detail: ProjectDetailData,
  actorId: string,
  auditActor: WorkspaceActor,
) {
  requireFixtureActor(context, actorId);
  requireAuthenticatedActor(context, auditActor);
  const state = readOperationsState(context);
  if (state.command.projectId !== detail.project.id) return state;
  const hydrated = hydrateOperationsFromProject(context, state);
  return saveOperationsState(context, {
    ...hydrated,
    events: [event(auditActor.id, "同步任务主数据", `${auditActor.name}在项目中心更新任务，角色工作台与领导决策进度已同步。`, state.command.id, auditActor.name), ...hydrated.events],
  });
}

function upsertKnowledgeForTask(entries: KnowledgeEntry[], task: OperationTask, actorId: string) {
  if (entries.some(({ sourceTaskId }) => sourceTaskId === task.id)) return entries;
  return [{ id: `knowledge-${task.id}`, commandId: task.commandId, sourceTaskId: task.id, title: `${task.title} · 交付成果`, summary: `由任务“${task.title}”验收通过后自动归档，保留执行记录和成果文件。`, category: task.department === "财务中心" ? "财务资料" as const : task.department === "人力资源中心" ? "人事资料" as const : "项目成果" as const, tags: ["AI试点", task.department], fileIds: [], status: "draft" as const, createdById: actorId, updatedAt: nowIso() }, ...entries];
}

export function updateSupportRequest(context: OperationFixtureContext, requestId: string, status: SupportRequestStatus, actorId: string, result?: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const request = state.supportRequests.find(({ id }) => id === requestId);
  if (!request) throw new Error("未找到协同申请");
  if (request.handlerId !== actorId) throw new Error("只有当前协同处理人可以办理该事项");
  const updatedAt = nowIso();
  const labels: Record<SupportRequestStatus, string> = { pending: "退回待处理", approved: "审批通过", in_progress: "开始办理", completed: "办理完成", rejected: "驳回" };
  const sourceTask = state.tasks.find(({ id }) => id === request.sourceTaskId);
  const shouldAdvanceSource = status === "completed" && sourceTask?.status === "in_progress";
  const tasks = state.tasks.map((item) => item.id === request.sourceTaskId && shouldAdvanceSource ? { ...item, progress: Math.max(item.progress, 75), updatedAt } : item);
  return saveOperationsState(context, {
    ...state,
    tasks,
    supportRequests: state.supportRequests.map((item) => item.id === requestId ? { ...item, status, result: result ?? item.result, updatedAt } : item),
    events: [event(actorId, labels[status], `${getActor(actorId).name}${labels[status]}“${request.title}”。`), ...state.events],
  });
}

export function createSupportRequest(context: OperationFixtureContext, sourceTaskId: string, type: "finance" | "staffing", actorId: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const task = state.tasks.find(({ id }) => id === sourceTaskId);
  if (!task) throw new Error("未找到任务");
  if (task.assigneeId !== actorId) throw new Error("只有任务执行人可以发起协同");
  if (!["in_progress", "blocked"].includes(task.status)) throw new Error("任务进入执行后才能发起协同");
  const duplicate = state.supportRequests.find((item) => item.sourceTaskId === sourceTaskId && item.type === type && !["completed", "rejected"].includes(item.status));
  if (duplicate) return state;
  const request: SupportRequest = type === "finance"
    ? { id: `support-${Date.now()}`, commandId: state.command.id, sourceTaskId, type, title: `${task.title} · 预算协同`, description: "请财务核验本任务所需预算并反馈办理结果。", requesterId: actorId, handlerId: "actor-finance", amountWan: 3, status: "pending", updatedAt: nowIso() }
    : { id: `support-${Date.now()}`, commandId: state.command.id, sourceTaskId, type, title: `${task.title} · 人员协同`, description: "请人事评估人员调配或临时支持方案。", requesterId: actorId, handlerId: "actor-hr", status: "pending", updatedAt: nowIso() };
  return saveOperationsState(context, { ...state, supportRequests: [request, ...state.supportRequests], events: [event(actorId, "发起协同", `${getActor(actorId).name}为“${task.title}”发起${type === "finance" ? "财务" : "人事"}协同。`), ...state.events] });
}

export function addOperationFile(context: OperationFixtureContext, file: OperationFile) {
  requireFixtureActor(context, file.uploadedById);
  const state = readOperationsState(context);
  const actor = requireActorById(file.uploadedById);
  if (file.entityType === "task") {
    const task = state.tasks.find(({ id }) => id === file.entityId);
    if (!task) throw new Error("未找到成果对应的任务");
    if (task.assigneeId !== actor.id) throw new Error("只有任务执行人可以上传成果");
    if (!["in_progress", "blocked"].includes(task.status)) throw new Error("任务进入执行后才能上传成果");
  }
  if (file.entityType === "support") {
    const request = state.supportRequests.find(({ id }) => id === file.entityId);
    if (!request || request.handlerId !== actor.id) throw new Error("只有当前协同处理人可以上传办理材料");
  }
  let knowledge = state.knowledge;
  if (file.entityType === "task") {
    knowledge = knowledge.map((entry) => entry.sourceTaskId === file.entityId ? { ...entry, fileIds: [...new Set([...entry.fileIds, file.id])], updatedAt: file.createdAt } : entry);
  }
  const attendance = file.entityType === "attendance"
    ? { ...state.attendance, corrections: state.attendance.corrections.map((item) => item.id === file.entityId ? { ...item, attachmentFileIds: [...new Set([...item.attachmentFileIds, file.id])], updatedAt: file.createdAt } : item) }
    : state.attendance;
  return saveOperationsState(context, { ...state, files: [file, ...state.files], knowledge, attendance, events: [event(file.uploadedById, "上传文件", `${actor.name}上传了“${file.name}”。`), ...state.events] });
}

export function addKnowledgeEntry(context: OperationFixtureContext, entry: KnowledgeEntry) {
  requireFixtureActor(context, entry.createdById);
  const state = readOperationsState(context);
  return saveOperationsState(context, { ...state, knowledge: [entry, ...state.knowledge], events: [event(entry.createdById, "沉淀知识", `${getActor(entry.createdById).name}新增知识“${entry.title}”。`), ...state.events] });
}

export function publishKnowledgeEntry(context: OperationFixtureContext, entryId: string, actorId: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const entry = state.knowledge.find(({ id }) => id === entryId);
  if (!entry) throw new Error("未找到知识文档");
  const updatedAt = nowIso();
  return saveOperationsState(context, { ...state, knowledge: state.knowledge.map((item) => item.id === entryId ? { ...item, status: "published" as const, updatedAt } : item), events: [event(actorId, "发布知识", `${getActor(actorId).name}发布了“${entry.title}”。`), ...state.events] });
}

export function submitLeaveRequest(context: OperationFixtureContext, input: Pick<LeaveRequest, "leaveType" | "startDate" | "endDate" | "days" | "reason" | "handover">, actorId: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const actor = getActor(actorId);
  if (!input.startDate || !input.endDate || input.days <= 0 || !input.reason.trim() || !input.handover.trim()) throw new Error("请完整填写请假时间、事由和工作交接");
  if (input.endDate < input.startDate) throw new Error("结束日期不能早于开始日期");
  const submittedAt = nowIso();
  const request: LeaveRequest = { id: `leave-${Date.now()}`, code: `LEAVE-${submittedAt.slice(0, 10).replaceAll("-", "")}-${String(state.leaveRequests.length + 1).padStart(3, "0")}`, employeeId: actorId, managerId: actor.role === "department_head" ? "actor-executive" : "actor-manager", ...input, reason: input.reason.trim(), handover: input.handover.trim(), status: "pending_manager", submittedAt, updatedAt: submittedAt };
  return saveOperationsState(context, { ...state, leaveRequests: [request, ...state.leaveRequests], events: [event(actorId, "提交请假", `${actor.name}提交${input.days}天请假申请，进入负责人审批。`), ...state.events] });
}

export function reviewLeaveRequest(context: OperationFixtureContext, requestId: string, action: "approve" | "reject" | "cancel", actorId: string, comment: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const request = state.leaveRequests.find(({ id }) => id === requestId);
  if (!request) throw new Error("未找到请假申请");
  const actor = getActor(actorId);
  let status: LeaveRequestStatus = request.status;
  if (action === "cancel") {
    if (actorId !== request.employeeId || request.status === "approved") throw new Error("当前申请不能撤回");
    status = "cancelled";
  } else if (action === "reject") {
    if (!comment.trim()) throw new Error("驳回时必须填写原因");
    status = "rejected";
  } else if (request.status === "pending_manager" && (actor.role === "department_head" || actor.role === "executive")) {
    status = "pending_hr";
  } else if (request.status === "pending_hr" && actor.role === "hr") {
    if (state.attendance.period.status === "locked" && request.startDate.startsWith(state.attendance.period.month)) throw new Error("该考勤周期已封账，请先走解锁审批流程");
    status = "approved";
  } else {
    throw new Error("当前角色不能处理这个审批节点");
  }
  const updatedAt = nowIso();
  const updated = { ...request, status, managerComment: request.status === "pending_manager" ? comment.trim() || "同意，交接安排清晰。" : request.managerComment, hrComment: request.status === "pending_hr" ? comment.trim() || "假期余额与考勤规则校验通过。" : request.hrComment, updatedAt };
  const actionLabel = action === "reject" ? "驳回请假" : action === "cancel" ? "撤回请假" : status === "pending_hr" ? "负责人同意" : "人事复核通过";
  return saveOperationsState(context, { ...state, leaveRequests: state.leaveRequests.map((item) => item.id === requestId ? updated : item), events: [event(actorId, actionLabel, `${actor.name}处理了${getActor(request.employeeId).name}的请假申请。`), ...state.events] });
}

function attendanceCode(prefix: string, date: string, count: number) {
  return `${prefix}-${date.replaceAll("-", "")}-${String(count + 1).padStart(3, "0")}`;
}

function minutesBetween(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return endHour * 60 + endMinute - startHour * 60 - startMinute;
}

function countOpenAttendanceItems(attendance: AttendanceOperations, month: string) {
  return attendance.corrections.filter((item) => item.date.startsWith(month) && ["pending_manager", "pending_hr"].includes(item.status)).length
    + attendance.overtimeRequests.filter((item) => item.date.startsWith(month) && ["pending_manager", "pending_hr"].includes(item.status)).length;
}

export function clockAttendance(context: OperationFixtureContext, actorId: string, kind: AttendancePunchKind, method: AttendancePunchMethod = "web") {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const actor = getActor(actorId);
  if (actor.role === "executive") throw new Error("决策人账号不参与日常打卡");
  const { demoDate, policy } = state.attendance;
  if (state.attendance.period.status === "locked" && demoDate.startsWith(state.attendance.period.month)) throw new Error("该考勤周期已封账，不能继续打卡");
  const shift = state.attendance.shifts.find((item) => item.employeeId === actorId && item.date === demoDate);
  if (!shift || shift.dayType !== "workday") throw new Error("当天没有排班，如需加班请先提交加班申请");
  const duplicate = state.attendance.punches.some((item) => item.employeeId === actorId && item.date === demoDate && item.kind === kind);
  if (duplicate) throw new Error(kind === "check_in" ? "今天已经签到" : "今天已经签退");
  if (kind === "check_out" && !state.attendance.punches.some((item) => item.employeeId === actorId && item.date === demoDate && item.kind === "check_in")) throw new Error("请先完成签到");
  const time = kind === "check_in" ? "08:56" : "18:06";
  const occurredAt = `${demoDate}T${time}:00+08:00`;
  const punch = { id: `punch-${Date.now()}`, employeeId: actorId, date: demoDate, kind, time, occurredAt, method, locationName: policy.locationName, verified: true };
  const action = kind === "check_in" ? "上班签到" : "下班签退";
  return saveOperationsState(context, { ...state, attendance: { ...state.attendance, punches: [punch, ...state.attendance.punches] }, events: [event(actorId, action, `${actor.name}于 ${time} 通过${method === "web" ? "工作站" : method === "office_wifi" ? "办公 Wi-Fi" : "手机定位"}${action}。`), ...state.events] });
}

export function submitAttendanceCorrection(context: OperationFixtureContext, input: { date: string; issueType: AttendanceIssueType; correctedTime: string; reason: string }, actorId: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const actor = getActor(actorId);
  if (actor.role === "executive" || actor.role === "hr") throw new Error("当前角色不发起个人补卡");
  if (!input.date || !input.correctedTime || !input.reason.trim()) throw new Error("请完整填写异常日期、修正时间和补卡原因");
  if (state.attendance.period.status === "locked" && input.date.startsWith(state.attendance.period.month)) throw new Error("该考勤周期已封账，补卡需由人事先发起解锁审批");
  const duplicate = state.attendance.corrections.some((item) => item.employeeId === actorId && item.date === input.date && !["approved", "rejected"].includes(item.status));
  if (duplicate) throw new Error("该日期已有待处理补卡申请");
  const submittedAt = nowIso();
  const request: AttendanceCorrectionRequest = { id: `correction-${Date.now()}`, code: attendanceCode("BUKA", input.date, state.attendance.corrections.length), employeeId: actorId, managerId: actor.role === "department_head" ? "actor-executive" : "actor-manager", date: input.date, issueType: input.issueType, correctedTime: input.correctedTime, reason: input.reason.trim(), attachmentFileIds: [], status: "pending_manager", submittedAt, updatedAt: submittedAt };
  const attendance = { ...state.attendance, corrections: [request, ...state.attendance.corrections] };
  return saveOperationsState(context, { ...state, attendance, payrollRun: { ...state.payrollRun, attendanceLocked: false, exceptionCount: countOpenAttendanceItems(attendance, state.attendance.period.month) }, events: [event(actorId, "提交补卡", `${actor.name}提交 ${input.date} 的补卡申请，进入负责人审批。`), ...state.events] });
}

export function reviewAttendanceCorrection(context: OperationFixtureContext, requestId: string, action: "approve" | "reject", actorId: string, comment: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const request = state.attendance.corrections.find(({ id }) => id === requestId);
  if (!request) throw new Error("未找到补卡申请");
  if (state.attendance.period.status === "locked" && request.date.startsWith(state.attendance.period.month)) throw new Error("该考勤周期已封账，不能再变更补卡状态");
  const actor = getActor(actorId);
  let status: AttendanceReviewStatus;
  if (request.status === "pending_manager" && (actorId === request.managerId || actor.role === "executive")) status = action === "approve" ? "pending_hr" : "rejected";
  else if (request.status === "pending_hr" && actor.role === "hr") status = action === "approve" ? "approved" : "rejected";
  else throw new Error("当前角色不能处理这个补卡节点");
  if (action === "reject" && !comment.trim()) throw new Error("驳回时必须填写原因");
  const updatedAt = nowIso();
  const updated = { ...request, status, managerComment: request.status === "pending_manager" ? comment.trim() || "异常说明与现场记录一致。" : request.managerComment, hrComment: request.status === "pending_hr" ? comment.trim() || "规则校验通过，准予修正。" : request.hrComment, updatedAt };
  const attendance = { ...state.attendance, corrections: state.attendance.corrections.map((item) => item.id === requestId ? updated : item) };
  return saveOperationsState(context, { ...state, attendance, payrollRun: { ...state.payrollRun, attendanceLocked: false, exceptionCount: countOpenAttendanceItems(attendance, state.attendance.period.month) }, events: [event(actorId, action === "approve" ? "审批补卡" : "驳回补卡", `${actor.name}${action === "approve" ? "处理并通过" : "驳回"}了 ${getActor(request.employeeId).name} 的补卡申请。`), ...state.events] });
}

export function submitOvertimeRequest(context: OperationFixtureContext, input: { date: string; startTime: string; endTime: string; reason: string }, actorId: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const actor = getActor(actorId);
  if (actor.role === "executive" || actor.role === "hr") throw new Error("当前角色不发起个人加班");
  if (state.attendance.period.status === "locked" && input.date.startsWith(state.attendance.period.month)) throw new Error("该考勤周期已封账，加班申请需由人事先发起解锁审批");
  const duration = minutesBetween(input.startTime, input.endTime);
  if (!input.date || !input.startTime || !input.endTime || !input.reason.trim()) throw new Error("请完整填写加班日期、时间和原因");
  if (duration < state.attendance.policy.overtimeMinimumMinutes) throw new Error(`加班时长不得少于 ${state.attendance.policy.overtimeMinimumMinutes} 分钟`);
  if (input.startTime < state.attendance.policy.overtimeStartsAfter) throw new Error(`工作日加班需从 ${state.attendance.policy.overtimeStartsAfter} 后开始`);
  const submittedAt = nowIso();
  const request: AttendanceOvertimeRequest = { id: `overtime-${Date.now()}`, code: attendanceCode("OT", input.date, state.attendance.overtimeRequests.length), employeeId: actorId, managerId: actor.role === "department_head" ? "actor-executive" : "actor-manager", date: input.date, startTime: input.startTime, endTime: input.endTime, hours: Math.round(duration / 6) / 10, reason: input.reason.trim(), status: "pending_manager", submittedAt, updatedAt: submittedAt };
  const attendance = { ...state.attendance, overtimeRequests: [request, ...state.attendance.overtimeRequests] };
  return saveOperationsState(context, { ...state, attendance, payrollRun: { ...state.payrollRun, attendanceLocked: false, exceptionCount: countOpenAttendanceItems(attendance, state.attendance.period.month) }, events: [event(actorId, "申请加班", `${actor.name}提交 ${request.hours} 小时加班申请。`), ...state.events] });
}

export function reviewOvertimeRequest(context: OperationFixtureContext, requestId: string, action: "approve" | "reject", actorId: string, comment: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const request = state.attendance.overtimeRequests.find(({ id }) => id === requestId);
  if (!request) throw new Error("未找到加班申请");
  const actor = getActor(actorId);
  if (state.attendance.period.status === "locked" && request.date.startsWith(state.attendance.period.month)) throw new Error("该考勤周期已封账，不能再变更加班状态");
  let status: AttendanceReviewStatus;
  if (request.status === "pending_manager" && (actorId === request.managerId || actor.role === "executive")) status = action === "approve" ? "pending_hr" : "rejected";
  else if (request.status === "pending_hr" && actor.role === "hr") status = action === "approve" ? "approved" : "rejected";
  else throw new Error("当前角色不能处理这个加班节点");
  if (action === "reject" && !comment.trim()) throw new Error("驳回时必须填写原因");
  const updatedAt = nowIso();
  const updated = { ...request, status, managerComment: request.status === "pending_manager" ? comment.trim() || "业务需要明确，同意。" : request.managerComment, hrComment: request.status === "pending_hr" ? comment.trim() || "工时与考勤记录校验通过。" : request.hrComment, updatedAt };
  const attendance = { ...state.attendance, overtimeRequests: state.attendance.overtimeRequests.map((item) => item.id === requestId ? updated : item) };
  return saveOperationsState(context, { ...state, attendance, payrollRun: { ...state.payrollRun, attendanceLocked: false, exceptionCount: countOpenAttendanceItems(attendance, state.attendance.period.month) }, events: [event(actorId, action === "approve" ? "审批加班" : "驳回加班", `${actor.name}${action === "approve" ? "处理并通过" : "驳回"}了 ${getActor(request.employeeId).name} 的加班申请。`), ...state.events] });
}

export function updateAttendancePolicy(context: OperationFixtureContext, patch: Pick<AttendancePolicy, "workStart" | "workEnd" | "breakStart" | "breakEnd" | "graceMinutes" | "overtimeStartsAfter" | "overtimeMinimumMinutes" | "correctionDeadlineDays">, actorId: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const actor = getActor(actorId);
  if (actor.role !== "hr") throw new Error("只有人事可以维护考勤制度");
  if (patch.workEnd <= patch.workStart || patch.breakEnd <= patch.breakStart) throw new Error("上下班或休息时间配置不正确");
  if (patch.graceMinutes < 0 || patch.graceMinutes > 30) throw new Error("迟到宽限应设置为 0–30 分钟");
  const updatedAt = nowIso();
  const policy = { ...state.attendance.policy, ...patch, updatedAt, updatedById: actorId };
  return saveOperationsState(context, { ...state, attendance: { ...state.attendance, policy }, events: [event(actorId, "更新考勤制度", `${actor.name}更新了“${policy.name}”，${policy.effectiveDate} 起生效。`), ...state.events] });
}

export function lockAttendancePeriod(context: OperationFixtureContext, actorId: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const actor = getActor(actorId);
  if (actor.role !== "hr") throw new Error("只有人事可以完成考勤封账");
  if (state.attendance.period.status === "locked") return state;
  const unresolvedCorrections = state.attendance.corrections.filter((item) => item.date.startsWith(state.attendance.period.month) && ["pending_manager", "pending_hr"].includes(item.status));
  const unresolvedOvertime = state.attendance.overtimeRequests.filter((item) => item.date.startsWith(state.attendance.period.month) && ["pending_manager", "pending_hr"].includes(item.status));
  const unresolvedCount = unresolvedCorrections.length + unresolvedOvertime.length;
  if (unresolvedCount) throw new Error(`仍有 ${unresolvedCount} 项补卡或加班事项未处理，不能封账`);
  const lockedAt = nowIso();
  const attendance = { ...state.attendance, period: { ...state.attendance.period, status: "locked" as const, lockedAt, lockedById: actorId } };
  const payrollRun = { ...state.payrollRun, attendanceLocked: true, exceptionCount: 0, updatedAt: lockedAt };
  return saveOperationsState(context, { ...state, attendance, payrollRun, events: [event(actorId, "考勤封账", `${actor.name}完成 ${state.attendance.period.month} 考勤封账，薪资核算输入已生成。`), ...state.events] });
}

export function updatePayrollRun(context: OperationFixtureContext, status: PayrollRunStatus, actorId: string) {
  requireFixtureActor(context, actorId);
  const state = readOperationsState(context);
  const actor = getActor(actorId);
  const current = state.payrollRun;
  const allowed = (current.status === "draft" && status === "calculated" && actor.role === "finance" && current.attendanceLocked)
    || (current.status === "calculated" && status === "verified" && actor.role === "hr")
    || (current.status === "verified" && status === "approved" && actor.role === "executive")
    || (current.status === "approved" && status === "paid" && actor.role === "finance");
  if (current.status === "draft" && status === "calculated" && !current.attendanceLocked) throw new Error("请先由人事完成考勤封账");
  if (!allowed) throw new Error("当前角色或薪资周期状态不允许执行此操作");
  const updatedAt = nowIso();
  const payrollRun = { ...current, status, exceptionCount: status === "verified" ? 0 : current.exceptionCount, calculatedAt: status === "calculated" ? updatedAt : current.calculatedAt, verifiedAt: status === "verified" ? updatedAt : current.verifiedAt, approvedAt: status === "approved" ? updatedAt : current.approvedAt, paidAt: status === "paid" ? updatedAt : current.paidAt, updatedAt };
  const labels: Record<PayrollRunStatus, string> = { draft: "建立薪资周期", calculated: "完成薪资核算", verified: "完成人员与考勤复核", approved: "批准薪资发放", paid: "完成工资发放" };
  return saveOperationsState(context, { ...state, payrollRun, events: [event(actorId, labels[status], `${actor.name}${labels[status]}（${current.month}）。`), ...state.events] });
}

export function setCommandStatus(context: OperationFixtureContext, status: CommandStatus, actorId: string) {
  const actor = requireFixtureActor(context, actorId);
  if (actor.role !== "executive") throw new Error("只有决策人可以推进总验收与归档");
  const state = readOperationsState(context);
  const allowedNext: Partial<Record<CommandStatus, CommandStatus>> = {
    executing: "review",
    review: "accepted",
    accepted: "archived",
  };
  if (allowedNext[state.command.status] !== status) {
    throw new Error("总验收状态必须按提交、通过、归档顺序推进");
  }
  if (status === "review" && state.supportRequests.some(({ status: requestStatus }) => !["completed", "rejected"].includes(requestStatus))) {
    throw new Error("仍有协同事项未办结，不能提交总验收");
  }
  if (state.tasks.some(({ status: taskStatus }) => taskStatus !== "done")) {
    throw new Error("仍有任务未验收，不能完成总验收");
  }
  const labels: Record<CommandStatus, string> = { executing: "恢复执行", review: "提交总验收", accepted: "完成总验收", archived: "归档闭环" };
  const updatedAt = nowIso();
  return saveOperationsState(context, { ...state, command: { ...state.command, status, updatedAt }, knowledge: status === "archived" ? state.knowledge.map((entry) => ({ ...entry, status: "published" as const, updatedAt })) : state.knowledge, events: [event(actorId, labels[status], `${getActor(actorId).name}${labels[status]}“${state.command.title}”。`), ...state.events] });
}

export function syncDecisionToOperations(context: OperationFixtureContext, input: DecisionInput, plan: DecisionPlan, projectId: string) {
  const actor = requireFixtureActor(context);
  if (actor.role !== "executive") throw new Error("只有显式绑定的决策人可以下发本地业务夹具");
  const state = readOperationsState(context);
  const memberActors = new Map(operationFixtureActors.map((actor) => [actor.memberId, actor.id]));
  const ownerByDepartment = new Map(plan.departments.map((department) => {
    const actorId = memberActors.get(department.owner.id);
    if (!actorId) throw new Error(`${department.name}负责人“${department.owner.displayName}”未配置工作站账号`);
    return [department.id, actorId] as const;
  }));
  const tasks = plan.departments.flatMap((department) => department.tasks.map<OperationTask>((task) => ({
    id: `${projectId}-${task.id}`,
    code: task.id,
    commandId: plan.id,
    department: department.name,
    departmentOwnerId: ownerByDepartment.get(department.id)!,
    assigneeId: requireActorByMemberId(task.assignee.id, `任务“${task.title}”`).id,
    title: task.title,
    summary: task.description,
    acceptance: task.acceptance,
    dueDate: task.dueDate,
    priority: task.priority === "low" ? "medium" : task.priority,
    status: "todo",
    progress: 0,
    deliverableRequired: true,
    dependencyIds: task.dependencies.map((dependencyId) => `${projectId}-${dependencyId}`),
    escalationLevel: "none",
    updatedAt: nowIso(),
  })));
  const command = { id: plan.id, title: input.goal, summary: input.constraints || "由 AI 拆解并下发的企业级决策。", ownerId: "actor-executive", status: "executing" as const, deadline: input.deadline, budgetWan: Number(input.budget) || 0, projectId, createdAt: plan.createdAt, updatedAt: nowIso() };
  return saveOperationsState(context, { ...state, command, tasks, supportRequests: [], files: [], knowledge: [], events: [event(actor.id, "确认下发", `${actor.name}确认 AI 拆解方案，${tasks.length} 项任务已进入角色工作台。`, plan.id), ...state.events] });
}
