import type { WorkspaceActor } from "@/features/auth/workspace-session-types";
import type { OperationTask } from "@/features/operations/operations-types";
import { getActor } from "@/features/operations/operations-data";
import type { ProjectDetailData, TaskStatus } from "@/features/projects/types";
import type { MobileTaskItem, MobileTaskStatus } from "@/features/mobile-workstation/mobile-workstation-types";
import { getTaskCenterAction } from "@/features/tasks/task-center-action";

const statusMap: Record<TaskStatus, MobileTaskStatus> = {
  backlog: "pending", todo: "pending", in_progress: "in_progress", blocked: "blocked", in_review: "review", done: "done", cancelled: "cancelled",
};

export function operationTasksForActor(tasks: readonly OperationTask[], actor: WorkspaceActor): MobileTaskItem[] {
  return tasks.filter(({ assigneeId, departmentOwnerId }) => assigneeId === actor.id || departmentOwnerId === actor.id).map((task) => ({
    id: task.id,
    title: task.title,
    assigneeName: actor.name,
    dueDate: task.dueDate,
    status: task.status === "todo" ? "pending" : task.status,
    priority: task.priority,
    progress: task.progress,
    href: getTaskCenterAction(actor.role, task.id).href,
    initiatedByViewer: task.departmentOwnerId === actor.id && task.assigneeId !== actor.id,
  }));
}

export function operationTasksForHome(tasks: readonly OperationTask[], actor: WorkspaceActor): MobileTaskItem[] {
  const scoped = tasks.filter((task) => task.assigneeId === actor.id);
  return scoped.map((task) => ({
    id: task.id,
    title: task.title,
    assigneeName: getActor(task.assigneeId).name,
    dueDate: task.dueDate,
    status: task.status === "todo" ? "pending" : task.status,
    priority: task.priority,
    progress: task.progress,
    href: getTaskCenterAction(actor.role, task.id).href,
    initiatedByViewer: task.departmentOwnerId === actor.id && task.assigneeId !== actor.id,
  }));
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
  return [...new Map(groups.flat().map((task) => [task.id, task])).values()];
}

export function mobilePersonalActionFallback(actor: WorkspaceActor): MobileTaskItem[] {
  const byRole = {
    executive: [
      ["审批部门提交的关键事项", "/approvals"],
      ["确认本周项目风险与资源安排", "/projects"],
      ["完成今日经营事项复盘", "/notifications"],
    ],
    department_head: [
      ["确认部门任务优先级与负责人", "/department"],
      ["验收成员提交的工作成果", "/tasks"],
      ["更新本周项目阶段进展", "/projects"],
    ],
    employee: [
      ["更新当前任务执行进度", "/execution"],
      ["提交今日工作成果", "/execution"],
      ["确认项目计划与截止时间", "/projects"],
    ],
    finance: [
      ["核对本月薪资计算结果", "/payroll"],
      ["处理待复核的费用申请", "/approvals"],
      ["确认银行发放回执", "/finance"],
    ],
    hr: [
      ["核对本月考勤异常", "/attendance"],
      ["处理待办人事审批", "/approvals"],
      ["复核薪资人员名单", "/hr"],
    ],
  } as const;
  const priorities = ["urgent", "high", "medium"] as const;
  return byRole[actor.role].map(([title, href], index) => ({
    id: `mobile-${actor.role}-${index + 1}`,
    title,
    assigneeName: actor.name,
    dueDate: `2026-08-${13 + index}`,
    status: "pending",
    priority: priorities[index],
    progress: 0,
    href,
    initiatedByViewer: false,
  }));
}
