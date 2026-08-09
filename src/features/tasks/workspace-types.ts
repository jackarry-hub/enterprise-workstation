import type { MemberSummary, TaskPriority, TaskStatus } from "@/features/projects/types";

export type WorkspaceTask = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  assignee: MemberSummary;
  dueDate?: string;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;
};

export type WorkspaceTodo = {
  id: string;
  type: "task" | "approval" | "notice";
  title: string;
  meta: string;
  time: string;
};

export type WorkspaceActivity = {
  id: string;
  projectName: string;
  content: string;
  createdAt: string;
  tone: "blue" | "green" | "purple" | "orange";
};

export type WorkspaceDailyReport = {
  projectId: string;
  todayCompleted: string;
  blockers: string;
  tomorrowPlan: string;
};

export type WorkspaceData = {
  viewerName: string;
  overview: {
    todayTaskCount: number;
    pendingApprovalCount: number;
    deadlineReminderCount: number;
    weeklyCompletionRate: number;
  };
  tasks: readonly WorkspaceTask[];
  todos: readonly WorkspaceTodo[];
  activities: readonly WorkspaceActivity[];
  dailyReport: WorkspaceDailyReport;
  projects: readonly { id: string; name: string }[];
  loadError?: string;
};

export type WorkspaceResult = {
  data: WorkspaceData;
  source: "supabase" | "mock";
};
