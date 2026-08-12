import type {
  ProjectDetailData,
  ProjectTask,
  TaskStatus,
} from "@/features/projects/types";
import type {
  AssigneeTaskDistribution,
  TaskCenterFilters,
  TaskCenterItem,
  TaskCenterStatus,
  TaskCenterSummary,
} from "@/features/tasks/task-center-types";
import type { WorkspaceActor } from "@/features/auth/workspace-session-types";

export function toTaskCenterStatus(status: TaskStatus): TaskCenterStatus {
  if (status === "backlog" || status === "todo") {
    return "pending";
  }
  if (status === "in_progress" || status === "blocked" || status === "in_review") {
    return "in_progress";
  }
  return status;
}

export function createTaskCenterItems(
  projects: readonly ProjectDetailData[],
): TaskCenterItem[] {
  return projects.flatMap((detail) => {
    const memberDirectory = new Map(
      detail.members.map(({ member }) => [member.id, member]),
    );
    memberDirectory.set(detail.owner.id, detail.owner);

    return detail.tasks.map((task) => ({
      project: detail.project,
      task,
      assignee: task.assigneeId ? memberDirectory.get(task.assigneeId) ?? null : null,
      reporter: memberDirectory.get(task.reporterId) ?? null,
    }));
  });
}

export function selectMyTaskItems(
  items: readonly TaskCenterItem[],
  viewerMemberId: string,
) {
  return items.filter(({ task }) => task.assigneeId === viewerMemberId);
}

export function scopeTaskCenterItems(
  items: readonly TaskCenterItem[],
  actor: WorkspaceActor,
) {
  return items.filter(({ task }) => task.assigneeId === actor.memberId);
}

export function filterTaskCenterItems(
  items: readonly TaskCenterItem[],
  filters: TaskCenterFilters,
): TaskCenterItem[] {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");

  return items.filter((item) => {
    const status = toTaskCenterStatus(item.task.status);
    const matchesTab = filters.tab === "all" || filters.tab === status;
    const matchesQuery = query === ""
      || item.task.title.toLocaleLowerCase("zh-CN").includes(query)
      || item.task.description.toLocaleLowerCase("zh-CN").includes(query)
      || item.project.name.toLocaleLowerCase("zh-CN").includes(query)
      || item.assignee?.displayName.toLocaleLowerCase("zh-CN").includes(query);

    return matchesTab
      && matchesQuery
      && (filters.projectId === "all" || item.project.id === filters.projectId)
      && (filters.assigneeId === "all" || item.task.assigneeId === filters.assigneeId)
      && (filters.priority === "all" || item.task.priority === filters.priority);
  });
}

export function calculateTaskCenterCompletionRate(
  tasks: readonly ProjectTask[],
) {
  const eligible = tasks.filter(({ status }) => status !== "cancelled");
  if (eligible.length === 0) {
    return 0;
  }
  return Math.round(
    (eligible.filter(({ status }) => status === "done").length / eligible.length) * 100,
  );
}

export function getTaskCenterSummary(
  items: readonly TaskCenterItem[],
  viewerMemberId: string,
): TaskCenterSummary {
  return {
    total: items.length,
    mine: selectMyTaskItems(items, viewerMemberId).length,
    pending: items.filter(({ task }) => toTaskCenterStatus(task.status) === "pending").length,
    inProgress: items.filter(({ task }) => toTaskCenterStatus(task.status) === "in_progress").length,
    done: items.filter(({ task }) => toTaskCenterStatus(task.status) === "done").length,
    cancelled: items.filter(({ task }) => toTaskCenterStatus(task.status) === "cancelled").length,
    completionRate: calculateTaskCenterCompletionRate(items.map(({ task }) => task)),
  };
}

export function getAssigneeDistribution(
  items: readonly TaskCenterItem[],
): AssigneeTaskDistribution[] {
  const groups = new Map<string, { member: NonNullable<TaskCenterItem["assignee"]>; tasks: ProjectTask[] }>();

  for (const item of items) {
    if (!item.assignee) {
      continue;
    }
    const existing = groups.get(item.assignee.id) ?? { member: item.assignee, tasks: [] };
    existing.tasks.push(item.task);
    groups.set(item.assignee.id, existing);
  }

  return [...groups.values()]
    .map(({ member, tasks }) => ({
      member,
      taskCount: tasks.length,
      completedCount: tasks.filter(({ status }) => status === "done").length,
      completionRate: calculateTaskCenterCompletionRate(tasks),
    }))
    .sort((left, right) => right.taskCount - left.taskCount || left.member.displayName.localeCompare(right.member.displayName, "zh-CN"));
}

export function getUpcomingTaskDeadlines(
  items: readonly TaskCenterItem[],
  limit = 5,
) {
  return items
    .filter(({ task }) => task.dueDate && !["done", "cancelled"].includes(task.status))
    .sort((left, right) => (
      (left.task.dueDate ?? "9999-12-31").localeCompare(right.task.dueDate ?? "9999-12-31")
    ))
    .slice(0, limit);
}
