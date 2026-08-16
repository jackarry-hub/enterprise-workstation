import type { WorkspaceActor } from "@/features/auth/workspace-session-types";
import { getActor } from "@/features/operations/operations-data";
import {
  selectAssignedTasks,
  selectInitiatedTasks,
} from "@/features/operations/operations-selectors";
import type { OperationTask, OperationsState } from "@/features/operations/operations-types";
import type { ProjectDetailData, TaskStatus } from "@/features/projects/types";
import type { MobileTaskItem, MobileTaskStatus } from "@/features/mobile-workstation/mobile-workstation-types";
import { getTaskCenterAction } from "@/features/tasks/task-center-action";

const statusMap: Record<TaskStatus, MobileTaskStatus> = {
  backlog: "pending", todo: "pending", in_progress: "in_progress", blocked: "blocked", in_review: "review", done: "done", cancelled: "cancelled",
};

const operationStatusMap: Record<OperationTask["status"], MobileTaskStatus> = {
  assigned: "pending",
  accepted: "pending",
  todo: "pending",
  in_progress: "in_progress",
  blocked: "blocked",
  review: "review",
  done: "done",
};

function toOperationMobileTask(
  task: OperationTask,
  actor: WorkspaceActor,
  initiatedByViewer: boolean,
): MobileTaskItem {
  return {
    id: task.id,
    title: task.title,
    assigneeName: getActor(task.assigneeId).name,
    dueDate: task.dueDate,
    status: operationStatusMap[task.status],
    priority: task.priority,
    progress: task.progress,
    href: getTaskCenterAction(actor.role, task.id).href,
    initiatedByViewer,
  };
}

export function operationTasksForActor(state: OperationsState, actor: WorkspaceActor): MobileTaskItem[] {
  return [
    ...selectAssignedTasks(state, actor.id).map((task) => toOperationMobileTask(task, actor, false)),
    ...selectInitiatedTasks(state, actor.id).map((task) => toOperationMobileTask(task, actor, true)),
  ];
}

export function operationTasksForHome(state: OperationsState, actor: WorkspaceActor): MobileTaskItem[] {
  return selectAssignedTasks(state, actor.id).map((task) => toOperationMobileTask(task, actor, false));
}

export function projectTasksForActor(projects: readonly ProjectDetailData[], actor: WorkspaceActor): MobileTaskItem[] {
  return projects.flatMap((detail) => detail.tasks.filter(({ assigneeId, reporterId, status }) => (assigneeId === actor.memberId || reporterId === actor.memberId) && status !== "cancelled").map((task) => ({
    id: task.id,
    title: task.title,
    assigneeName: actor.name,
    dueDate: task.dueDate ?? detail.project.dueDate,
    status: statusMap[task.status],
    priority: task.priority,
    progress: task.progress,
    href: `/projects/${detail.project.id}?tab=tasks&task=${task.id}`,
    initiatedByViewer: task.reporterId === actor.memberId && task.assigneeId !== actor.memberId,
  })));
}

export function mergeMobileTasks(...groups: readonly MobileTaskItem[][]) {
  const byId = new Map<string, MobileTaskItem>();
  for (const task of groups.flat()) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  return [...byId.values()];
}

export function selectMobileTasksForScope(
  realTasks: readonly MobileTaskItem[],
  scope: "assigned" | "initiated",
) {
  return realTasks.filter(({ initiatedByViewer }) => (
    scope === "initiated" ? initiatedByViewer : !initiatedByViewer
  ));
}
