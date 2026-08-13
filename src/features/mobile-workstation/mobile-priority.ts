import type { TaskPriority } from "@/features/projects/types";
import type { MobilePriorityTone, MobileTaskItem, MobileTaskStatus } from "@/features/mobile-workstation/mobile-workstation-types";

const priorityWeights: Record<TaskPriority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

const terminalStatuses = new Set<MobileTaskStatus>(["done", "cancelled"]);

export function isMobileTaskOverdue(task: Pick<MobileTaskItem, "dueDate" | "status">, today: string) {
  return !terminalStatuses.has(task.status) && task.dueDate < today;
}

export function getMobilePriorityMeta(priority: TaskPriority, overdue = false, status: MobileTaskStatus = "pending"): { label: string; tone: MobilePriorityTone } {
  if (overdue && !terminalStatuses.has(status)) return { label: "逾期", tone: "urgent" };
  if (priority === "urgent") return { label: "紧急", tone: "urgent" };
  if (priority === "high") return { label: "高", tone: "high" };
  return { label: "普通", tone: "normal" };
}

export function sortMobileTasksByPriority(items: readonly MobileTaskItem[], today: string) {
  return [...items].sort((left, right) => {
    const leftOverdue = isMobileTaskOverdue(left, today);
    const rightOverdue = isMobileTaskOverdue(right, today);
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    const priorityDifference = priorityWeights[left.priority] - priorityWeights[right.priority];
    if (priorityDifference !== 0) return priorityDifference;
    const dateDifference = left.dueDate.localeCompare(right.dueDate);
    return dateDifference || left.title.localeCompare(right.title, "zh-CN");
  });
}

