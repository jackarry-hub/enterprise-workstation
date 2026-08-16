import type { WorkspaceRole } from "@/features/auth/workspace-session-types";

export type TaskCenterAction = {
  href: string;
  label: string;
};

const actionByRole: Record<WorkspaceRole, TaskCenterAction> = {
  executive: { href: "/execution", label: "前往我的执行工作台" },
  department_head: { href: "/department", label: "前往负责人工作台" },
  employee: { href: "/execution", label: "前往我的执行工作台" },
  finance: { href: "/finance", label: "前往财务执行中心" },
  hr: { href: "/hr", label: "前往人事协同中心" },
};

export function getTaskCenterAction(
  role: WorkspaceRole,
  taskId?: string,
  focus: "task" | "review" = "task",
) {
  const action = actionByRole[role];
  if (!taskId) return action;
  return {
    href: `${action.href}#${focus}-${taskId}`,
    label: focus === "review" ? "直接验收当前任务" : "直接办理当前任务",
  };
}
