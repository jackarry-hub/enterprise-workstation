import type {
  MemberSummary,
  Project,
  ProjectTask,
  TaskPriority,
} from "@/features/projects/types";

export type TaskCenterTab = "all" | "mine" | "pending" | "in_progress" | "done";
export type TaskCenterStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface TaskCenterItem {
  project: Project;
  task: ProjectTask;
  assignee: MemberSummary | null;
  reporter: MemberSummary | null;
}

export interface TaskCenterFilters {
  query: string;
  tab: TaskCenterTab;
  projectId: string;
  assigneeId: string;
  priority: TaskPriority | "all";
}

export interface AssigneeTaskDistribution {
  member: MemberSummary;
  taskCount: number;
  completedCount: number;
  completionRate: number;
}

export interface TaskCenterSummary {
  total: number;
  mine: number;
  pending: number;
  inProgress: number;
  done: number;
  cancelled: number;
  completionRate: number;
}
