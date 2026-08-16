import type { TaskPriority } from "@/features/projects/types";

export type MobileTaskStatus = "pending" | "in_progress" | "review" | "blocked" | "done" | "cancelled";

export type MobileTaskItem = {
  id: string;
  title: string;
  assigneeName: string;
  dueDate: string;
  status: MobileTaskStatus;
  priority: TaskPriority;
  progress: number;
  href: string;
  initiatedByViewer: boolean;
  requiresViewerReview?: boolean;
};

export type MobilePriorityTone = "urgent" | "high" | "normal";
