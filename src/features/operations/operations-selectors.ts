import type { WorkspaceActor } from "@/features/auth/workspace-session-types";
import { getTaskReviewerId } from "@/features/operations/operations-data";
import type { OperationTask, OperationsState } from "@/features/operations/operations-types";
import { getTaskCenterAction } from "@/features/tasks/task-center-action";

export type TodayAction = {
  taskId: string;
  kind: "task" | "review";
  title: string;
  priority: OperationTask["priority"];
  dueDate: string;
  href: string;
};

const priorityRank: Record<OperationTask["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
};

export const selectAssignedTasks = (state: OperationsState, actorId: string) => (
  state.tasks.filter(({ assigneeId }) => assigneeId === actorId)
);

export const selectInitiatedTasks = (state: OperationsState, actorId: string) => (
  state.tasks.filter((task) => (
    task.assigneeId !== actorId
    && (task.creatorId === actorId || task.departmentOwnerId === actorId)
  ))
);

export const selectReviewTasks = (state: OperationsState, actorId: string) => (
  state.tasks.filter((task) => (
    task.assigneeId !== actorId
    && task.status === "review"
    && getTaskReviewerId(task) === actorId
  ))
);

function comparePriorityThenDeadline(left: TodayAction, right: TodayAction) {
  return priorityRank[left.priority] - priorityRank[right.priority]
    || left.dueDate.localeCompare(right.dueDate)
    || left.taskId.localeCompare(right.taskId);
}

function toTodayAction(
  task: OperationTask,
  actor: WorkspaceActor,
  kind: TodayAction["kind"],
): TodayAction {
  return {
    taskId: task.id,
    kind,
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate,
    href: getTaskCenterAction(actor.role, task.id, kind).href,
  };
}

export function selectTodayActions(state: OperationsState, actor: WorkspaceActor) {
  const personal = selectAssignedTasks(state, actor.id)
    .filter(({ status }) => status !== "done" && status !== "review")
    .map((task) => toTodayAction(task, actor, "task"));
  const review = selectReviewTasks(state, actor.id)
    .map((task) => toTodayAction(task, actor, "review"));

  return [...personal, ...review].sort(comparePriorityThenDeadline).slice(0, 5);
}

export function selectProjectProgress(state: OperationsState, projectId: string) {
  const tasks = state.tasks.filter((task) => task.projectId === projectId);
  return tasks.length
    ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length)
    : 0;
}
