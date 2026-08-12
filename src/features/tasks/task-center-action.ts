import type { WorkspaceRole } from "@/features/auth/workspace-session-types";

export type TaskCenterAction = {
  href: string;
  label: string;
};

const actionByRole: Record<WorkspaceRole, TaskCenterAction> = {
  executive: { href: "/dashboard", label: "返回领导调度台" },
  department_head: { href: "/department", label: "前往负责人工作台" },
  employee: { href: "/execution", label: "前往我的执行工作台" },
  finance: { href: "/finance", label: "前往财务执行中心" },
  hr: { href: "/hr", label: "前往人事协同中心" },
};

export function getTaskCenterAction(role: WorkspaceRole, taskId?: string) {
  const action = actionByRole[role];
  if (!taskId || role === "executive") return action;
  return {
    href: `${action.href}#task-${taskId}`,
    label: "直接办理当前任务",
  };
}
