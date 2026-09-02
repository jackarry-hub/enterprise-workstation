import type { WorkspaceRole } from "@/features/auth/workspace-session-types";

export type TaskCenterAction = {
  href: string;
  label: string;
};

const actionByRole: Record<WorkspaceRole, TaskCenterAction> = {
  executive: { href: "/dashboard", label: "返回领导调度台" },
  department_head: { href: "/projects", label: "前往项目管理" },
  employee: { href: "/execution", label: "前往我的执行工作台" },
  finance: { href: "/approvals", label: "前往审批与财务" },
  hr: { href: "/people", label: "前往组织人事" },
};

export function getTaskCenterAction(role: WorkspaceRole) {
  return actionByRole[role];
}
