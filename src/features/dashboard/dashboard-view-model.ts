import type { WorkspaceActor, WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getActor, getTaskReviewerId } from "@/features/operations/operations-data";
import type { ExecutionSummaryInput } from "@/features/ai-dispatch/summary-contract";
import {
  selectAssignedTasks,
  selectReviewTasks,
  selectTodayActions,
} from "@/features/operations/operations-selectors";
import type { OperationsState, OperationTask, OperationTaskStatus } from "@/features/operations/operations-types";
import type { ProjectDetailData, ProjectHealth, ProjectMemberRole } from "@/features/projects/types";

export type DashboardDataSource = "real" | "mock" | "placeholder";
export type DashboardPriority = "urgent" | "high" | "medium";
export type DashboardTodoCategory = "task" | "deadline" | "acceptance" | "decision" | "risk";

export type DashboardTaskItem = {
  sourceId: string;
  title: string;
  summary: string;
  dueDate: string;
  priority: DashboardPriority;
  status: "assigned" | "accepted" | "todo" | "in_progress" | "review" | "done" | "blocked";
  progress: number;
  href: string;
  source: DashboardDataSource;
};

export type DashboardTodoItem = DashboardTaskItem & {
  category: DashboardTodoCategory;
  actionLabel?: string;
};

export type DashboardProjectItem = {
  id: string;
  name: string;
  role: string;
  progress: number;
  deadline: string;
  health: ProjectHealth;
  href: string;
  source: DashboardDataSource;
};

export type DashboardReminder = {
  id: string;
  title: string;
  detail: string;
  tone: "warning" | "danger" | "info";
  href: string;
  source: DashboardDataSource;
};

export type DashboardDispatchStage = "not_started" | "started" | "review" | "done";

export type DashboardDispatchTaskItem = {
  id: string;
  title: string;
  assignee: string;
  statusLabel: string;
  stage: DashboardDispatchStage;
  progress: number;
  dueDate: string;
  blocked: boolean;
  href?: string;
};

export type DashboardViewModel = {
  source: DashboardDataSource;
  identity: {
    name: string;
    titleLine: string;
    status: "available" | "working" | "busy" | "blocked";
    statusLabel: string;
    dateLabel: string;
  };
  today: { items: DashboardTodoItem[] };
  dispatch: {
    canUse: boolean;
    scopeLabel: string;
    current: {
      commandId: string;
      title: string;
      status: OperationsState["command"]["status"];
      deadline: string;
      total: number;
      completed: number;
      progress: number;
      participantCount: number;
      rejectionCount: number;
      stageCounts: Record<DashboardDispatchStage, number>;
      tasks: DashboardDispatchTaskItem[];
      completedAt?: string;
      isOwner: boolean;
      summary: OperationsState["command"]["aiSummary"];
      summaryModel?: string;
      execution: ExecutionSummaryInput | null;
    } | null;
    history: OperationsState["dispatchHistory"];
  };
  tasks: {
    total: number;
    todo: number;
    inProgress: number;
    review: number;
    done: number;
    items: DashboardTaskItem[];
    source: DashboardDataSource;
  };
  projects: {
    items: DashboardProjectItem[];
    source: DashboardDataSource;
  };
  value: {
    completedThisMonth: number;
    contribution: number | null;
    pendingAmount: number | null;
    settledAmount: number | null;
    message: string;
    source: "placeholder";
  };
  reminders: DashboardReminder[];
};

const priorityOrder: Record<DashboardPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
};

const dispatchTaskStatusLabel: Record<OperationTaskStatus, string> = {
  assigned: "新任务",
  accepted: "已接受",
  todo: "待开始",
  in_progress: "进行中",
  blocked: "已阻塞",
  review: "待验收",
  done: "已完成",
};

function dispatchStage(status: OperationTaskStatus): DashboardDispatchStage {
  if (["assigned", "accepted", "todo"].includes(status)) return "not_started";
  if (["in_progress", "blocked"].includes(status)) return "started";
  return status === "review" ? "review" : "done";
}

const projectRoleLabel: Record<ProjectMemberRole, string> = {
  owner: "负责人",
  manager: "项目管理",
  member: "项目成员",
  viewer: "协作成员",
};

function dateInShanghai(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dateLabel(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function taskItem(
  task: OperationTask,
  source: DashboardDataSource,
  landingPath: string,
): DashboardTaskItem {
  return {
    sourceId: task.id,
    title: task.title,
    summary: task.summary,
    dueDate: task.dueDate,
    priority: task.priority,
    status: task.status,
    progress: task.progress,
    href: `${landingPath}#task-${task.id}`,
    source,
  };
}

function sortTaskItems<T extends DashboardTaskItem>(items: T[]) {
  return items.sort((left, right) => (
    priorityOrder[left.priority] - priorityOrder[right.priority]
    || left.dueDate.localeCompare(right.dueDate)
  ));
}

function categoryForTask(task: OperationTask, today: string): DashboardTodoCategory {
  if (task.status === "blocked" || task.dueDate < today) return "risk";
  if (task.status === "review") return "acceptance";
  if (task.dueDate <= today) return "task";
  return "deadline";
}

function workStatus(tasks: readonly OperationTask[]) {
  const active = tasks.filter(({ status }) => !["done"].includes(status));
  if (active.some(({ status }) => status === "blocked")) {
    return { status: "blocked" as const, statusLabel: "需支援" };
  }
  if (active.length >= 3) {
    return { status: "busy" as const, statusLabel: "满负荷" };
  }
  if (active.length) {
    return { status: "working" as const, statusLabel: "执行中" };
  }
  return { status: "available" as const, statusLabel: "可接受任务" };
}

function dispatchScope(session: WorkspaceSession) {
  if (session.primaryRole === "executive") return "全公司";
  if (["department_head", "finance", "hr"].includes(session.primaryRole)) {
    return `本部门 · ${session.profile.departmentName}`;
  }
  return "仅本人及授权协作者";
}

function relatedProjects(
  projects: readonly ProjectDetailData[],
  actor: WorkspaceActor,
  source: DashboardDataSource,
) {
  return projects.flatMap((detail): DashboardProjectItem[] => {
    const membership = detail.members.find(({ member }) => member.id === actor.memberId);
    const isOwner = detail.owner.id === actor.memberId || detail.project.ownerId === actor.memberId;
    const isCreator = detail.project.createdById === actor.memberId;
    if (!membership && !isOwner && !isCreator) return [];
    const role = isOwner ? "负责人" : membership ? projectRoleLabel[membership.role] : "项目发起人";
    return [{
      id: detail.project.id,
      name: detail.project.name,
      role,
      progress: detail.project.progress,
      deadline: detail.project.dueDate,
      health: detail.project.health,
      href: `/projects/${detail.project.id}`,
      source,
    }];
  }).sort((left, right) => left.deadline.localeCompare(right.deadline));
}

function buildReminders(
  ownTasks: readonly OperationTask[],
  reviewTasks: readonly OperationTask[],
  projects: readonly DashboardProjectItem[],
  today: string,
  source: DashboardDataSource,
) {
  const reminders: DashboardReminder[] = [];
  ownTasks.forEach((task) => {
    if (task.status === "blocked") {
      reminders.push({ id: `blocked-${task.id}`, title: "任务存在阻塞", detail: task.title, tone: "danger", href: `/tasks#task-${task.id}`, source });
    } else if (task.status !== "done" && task.dueDate < today) {
      reminders.push({ id: `overdue-${task.id}`, title: "任务已经超期", detail: `${task.title} · 截止 ${task.dueDate}`, tone: "danger", href: `/tasks#task-${task.id}`, source });
    }
  });
  reviewTasks.forEach((task) => reminders.push({
    id: `review-${task.id}`,
    title: "存在待验收成果",
    detail: task.title,
    tone: "warning",
    href: `/tasks#task-${task.id}`,
    source,
  }));
  projects.filter(({ health }) => health !== "on_track").forEach((project) => reminders.push({
    id: `project-${project.id}`,
    title: "项目存在延期风险",
    detail: project.name,
    tone: project.health === "off_track" ? "danger" : "warning",
    href: project.href,
    source,
  }));
  return reminders.slice(0, 4);
}

export function buildDashboardViewModel({
  session,
  actor,
  state,
  projects,
  now,
  source,
}: {
  session: WorkspaceSession;
  actor: WorkspaceActor;
  state: OperationsState;
  projects: readonly ProjectDetailData[];
  now: Date;
  source: DashboardDataSource;
}): DashboardViewModel {
  const today = dateInShanghai(now);
  const personalTaskPath = actor.role === "executive" ? "/execution" : actor.landingPath;
  const ownTasks = selectAssignedTasks(state, actor.id);
  const reviewTasks = selectReviewTasks(state, actor.id);
  const runtimeTasks = state.activeAiWorkstreamId
    ? state.tasks.filter(({ workstreamId }) => workstreamId === state.activeAiWorkstreamId)
    : state.tasks.filter((task) => (
      task.runtimeSource === "ai_dispatch" && task.commandId === state.command.id
    ));
  const isRuntimeDispatch = state.command.id.startsWith("ai-command-") && runtimeTasks.length > 0;
  const completedTasks = runtimeTasks.filter(({ status: taskStatus }) => taskStatus === "done");
  const runtimeProgress = runtimeTasks.length
    ? Math.round(completedTasks.length / runtimeTasks.length * 100)
    : 0;
  const allRuntimeTasksDone = isRuntimeDispatch
    && completedTasks.length === runtimeTasks.length;
  const isDispatchOwner = isRuntimeDispatch
    && state.command.status !== "archived"
    && state.command.ownerId === actor.id
    && runtimeTasks.length > 0;
  const dispatchOwnerHref = "/dashboard#ai-dispatch-progress";
  const dispatchReviewAction = runtimeTasks.find((task) => (
    task.status === "review" && getTaskReviewerId(task) === actor.id
  ));
  const dispatchExecutionAction = runtimeTasks.find((task) => (
    task.assigneeId === actor.id && task.status !== "done" && task.status !== "review"
  ));
  const dispatchOwnerAction = dispatchReviewAction ?? dispatchExecutionAction;
  const dispatchOwnerTodayHref = dispatchReviewAction
    ? `${personalTaskPath}#review-${dispatchReviewAction.id}`
    : dispatchExecutionAction
      ? `${personalTaskPath}#task-${dispatchExecutionAction.id}`
      : dispatchOwnerHref;
  const dispatchOwnerTask: DashboardTaskItem | null = isDispatchOwner ? {
    sourceId: `dispatch-owner-${state.command.id}`,
    title: `统筹与复盘：${state.command.title}`,
    summary: allRuntimeTasksDone
      ? state.command.aiSummary
        ? "执行总结已生成，完成归档后关闭本次调度。"
        : "全部任务已验收，生成执行总结后归档。"
      : `跟进 ${runtimeTasks.length} 项执行任务的进度、风险和验收。`,
    dueDate: state.command.deadline,
    priority: "high",
    status: allRuntimeTasksDone ? "review" : "in_progress",
    progress: runtimeProgress,
    href: dispatchOwnerHref,
    source,
  } : null;
  const dispatchOwnerToday: DashboardTodoItem | null = dispatchOwnerTask ? {
    ...dispatchOwnerTask,
    title: allRuntimeTasksDone
      ? state.command.aiSummary
        ? `归档本次调度：${state.command.title}`
        : `生成执行总结：${state.command.title}`
      : dispatchReviewAction
        ? `验收：${dispatchReviewAction.title}`
        : dispatchExecutionAction
          ? `办理：${dispatchExecutionAction.title}`
          : `跟进调度进度：${state.command.title}`,
    href: dispatchOwnerTodayHref,
    category: dispatchReviewAction ? "acceptance" : dispatchExecutionAction ? "task" : "decision",
    actionLabel: allRuntimeTasksDone
      ? state.command.aiSummary ? "去归档" : "生成总结"
      : dispatchReviewAction
        ? "去验收"
        : dispatchOwnerAction
          ? "去办理"
          : "查看进度",
  } : null;
  const dispatchOwnerProject: DashboardProjectItem | null = isDispatchOwner ? {
    id: `dispatch-project-${state.command.id}`,
    name: state.command.title,
    role: "发起人 · 总负责人",
    progress: runtimeProgress,
    deadline: state.command.deadline,
    health: state.command.deadline < today && !allRuntimeTasksDone ? "off_track" : "on_track",
    href: dispatchOwnerHref,
    source,
  } : null;
  const allTaskItems = sortTaskItems([
    ...(dispatchOwnerTask ? [dispatchOwnerTask] : []),
    ...ownTasks.map((task) => taskItem(task, source, personalTaskPath)),
  ]);
  const personalTodayItems = sortTaskItems(selectTodayActions(state, actor).flatMap((action) => {
    const task = state.tasks.find(({ id }) => id === action.taskId);
    if (!task) return [];
    return [{
      ...taskItem(task, source, personalTaskPath),
      href: action.href,
      category: action.kind === "review" ? "acceptance" as const : categoryForTask(task, today),
    }];
  }));
  const todayItems = [
    ...(dispatchOwnerToday ? [dispatchOwnerToday] : []),
    ...personalTodayItems,
  ].slice(0, 5);
  const projectsForActor = [
    ...(dispatchOwnerProject ? [dispatchOwnerProject] : []),
    ...relatedProjects(projects, actor, source),
  ];
  const status = dispatchOwnerTask
    ? { status: "working" as const, statusLabel: "执行中" }
    : workStatus(ownTasks);
  const currentMonth = today.slice(0, 7);
  const canUseDispatch = ["executive", "department_head", "finance", "hr"]
    .includes(session.primaryRole);
  const dispatchTasks: DashboardDispatchTaskItem[] = isRuntimeDispatch
    ? runtimeTasks.map((task) => ({
      id: task.id,
      title: task.title,
      assignee: getActor(task.assigneeId).name,
      statusLabel: dispatchTaskStatusLabel[task.status],
      stage: dispatchStage(task.status),
      progress: task.progress,
      dueDate: task.dueDate,
      blocked: task.status === "blocked",
      href: task.assigneeId === actor.id
        ? `${personalTaskPath}#task-${task.id}`
        : task.status === "review" && getTaskReviewerId(task) === actor.id
          ? `${personalTaskPath}#review-${task.id}`
          : undefined,
    }))
    : [];
  const stageCounts = dispatchTasks.reduce<Record<DashboardDispatchStage, number>>((counts, task) => {
    counts[task.stage] += 1;
    return counts;
  }, { not_started: 0, started: 0, review: 0, done: 0 });
  const execution: ExecutionSummaryInput | null = allRuntimeTasksDone ? {
    goal: state.command.title,
    tasks: runtimeTasks.map((task) => ({
      title: task.title,
      assignee: getActor(task.assigneeId).name,
      status: "done" as const,
      submission: [
        task.submission?.description,
        task.submission?.url,
        task.submission?.attachmentName,
        task.submission?.note,
      ].filter(Boolean).join("；") || "成果已通过验收",
      review_comment: task.reviewComment || task.reviewNote || "验收通过",
      rejection_count: task.rejectionCount ?? 0,
    })),
  } : null;

  return {
    source,
    identity: {
      name: session.profile.displayName || actor.name,
      titleLine: `${session.profile.jobTitle || actor.title} · ${session.profile.departmentName || actor.department}`,
      ...status,
      dateLabel: dateLabel(now),
    },
    today: { items: todayItems },
    dispatch: {
      canUse: canUseDispatch,
      scopeLabel: dispatchScope(session),
      current: isRuntimeDispatch && state.command.status !== "archived" ? {
        commandId: state.command.id,
        title: state.command.title,
        status: state.command.status,
        deadline: state.command.deadline,
        total: runtimeTasks.length,
        completed: completedTasks.length,
        progress: runtimeProgress,
        participantCount: new Set(runtimeTasks.map(({ assigneeId }) => assigneeId)).size,
        rejectionCount: runtimeTasks.reduce((sum, task) => sum + (task.rejectionCount ?? 0), 0),
        stageCounts,
        tasks: dispatchTasks,
        completedAt: allRuntimeTasksDone ? state.command.updatedAt : undefined,
        isOwner: state.command.ownerId === actor.id,
        summary: state.command.aiSummary,
        summaryModel: state.command.summaryModel,
        execution,
      } : null,
      history: state.dispatchHistory,
    },
    tasks: {
      total: ownTasks.length + (dispatchOwnerTask ? 1 : 0),
      todo: ownTasks.filter(({ status: taskStatus }) => ["assigned", "accepted", "todo"].includes(taskStatus)).length,
      inProgress: ownTasks.filter(({ status: taskStatus }) => taskStatus === "in_progress" || taskStatus === "blocked").length
        + (dispatchOwnerTask?.status === "in_progress" ? 1 : 0),
      review: ownTasks.filter(({ status: taskStatus }) => taskStatus === "review").length
        + (dispatchOwnerTask?.status === "review" ? 1 : 0),
      done: ownTasks.filter(({ status: taskStatus }) => taskStatus === "done").length,
      items: allTaskItems,
      source,
    },
    projects: { items: projectsForActor, source },
    value: {
      completedThisMonth: ownTasks.filter(({ status: taskStatus, updatedAt }) => taskStatus === "done" && updatedAt.startsWith(currentMonth)).length,
      contribution: null,
      pendingAmount: null,
      settledAmount: null,
      message: "价值体系待启用",
      source: "placeholder",
    },
    reminders: buildReminders(ownTasks, reviewTasks, projectsForActor, today, source),
  };
}
