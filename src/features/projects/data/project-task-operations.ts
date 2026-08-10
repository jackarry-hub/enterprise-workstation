import type {
  ProjectActivity,
  ProjectDetailData,
  ProjectTask,
  TaskComment,
  TaskPriority,
} from "@/features/projects/types";
import type { WorkspaceActor } from "@/features/auth/workspace-session-types";

export type TaskExecutionStatus = "todo" | "in_progress" | "done";

export type CreateMockTaskInput = {
  title: string;
  description: string;
  assigneeId: string;
  dueDate: string;
  priority: TaskPriority;
};

export type TaskOperationOptions = {
  now?: () => Date;
  createId?: () => string;
};

function currentDate(options?: TaskOperationOptions) {
  return options?.now?.() ?? new Date();
}

function createIdentifier(options?: TaskOperationOptions) {
  return options?.createId?.() ?? crypto.randomUUID();
}

export function calculateProjectProgress(tasks: readonly ProjectTask[]) {
  const executableTasks = tasks.filter(({ status }) => status !== "cancelled");
  if (executableTasks.length === 0) {
    return 0;
  }

  const completed = executableTasks.filter(({ status }) => status === "done").length;
  return Math.round((completed / executableTasks.length) * 100);
}

export function createMockTask(
  detail: ProjectDetailData,
  input: CreateMockTaskInput,
  actor: WorkspaceActor,
  options?: TaskOperationOptions,
): ProjectDetailData {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title) {
    throw new Error("请输入任务名称");
  }
  if (!input.assigneeId) {
    throw new Error("请选择任务负责人");
  }

  const membership = detail.members.find(
    ({ member, leftAt }) => member.id === input.assigneeId && !leftAt,
  );
  if (!membership) {
    throw new Error("负责人必须是当前项目成员");
  }
  if (!input.dueDate) {
    throw new Error("请选择任务截止日期");
  }
  if (input.dueDate < detail.project.startDate) {
    throw new Error("任务截止日期不能早于项目开始日期");
  }

  const timestamp = currentDate(options).toISOString();
  const sortOrder = detail.tasks.reduce(
    (maximum, task) => Math.max(maximum, task.sortOrder),
    -1,
  ) + 1;
  const task: ProjectTask = {
    id: createIdentifier(options),
    organizationId: detail.project.organizationId,
    projectId: detail.project.id,
    title,
    description,
    assigneeId: membership.member.id,
    reporterId: detail.owner.id,
    status: "todo",
    priority: input.priority,
    dueDate: input.dueDate,
    progress: 0,
    sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const tasks = [...detail.tasks, task];
  const activity: ProjectActivity = {
    id: createIdentifier(options),
    organizationId: detail.project.organizationId,
    projectId: detail.project.id,
    userId: actor.id,
    actionType: "task_updated",
    content: `${actor.name}创建了任务“${task.title}”。`,
    createdAt: timestamp,
  };

  return {
    ...detail,
    project: {
      ...detail.project,
      progress: calculateProjectProgress(tasks),
      updatedAt: timestamp,
    },
    tasks,
    activities: [activity, ...detail.activities],
  };
}

const taskProgress: Record<TaskExecutionStatus, number> = {
  todo: 0,
  in_progress: 50,
  done: 100,
};

export function updateMockTaskStatus(
  detail: ProjectDetailData,
  taskId: string,
  status: TaskExecutionStatus,
  actor: WorkspaceActor,
  options?: TaskOperationOptions,
): ProjectDetailData {
  if (!detail.tasks.some(({ id }) => id === taskId)) {
    return detail;
  }

  const timestamp = currentDate(options).toISOString();
  const previousTask = detail.tasks.find(({ id }) => id === taskId);
  const tasks = detail.tasks.map((task): ProjectTask => task.id === taskId
    ? {
      ...task,
      status,
      progress: taskProgress[status],
      completedAt: status === "done" ? timestamp : undefined,
      updatedAt: timestamp,
    }
    : task);

  const statusLabels: Record<TaskExecutionStatus, string> = { todo: "待开始", in_progress: "进行中", done: "已完成" };
  const activity: ProjectActivity = {
    id: createIdentifier(options),
    organizationId: detail.project.organizationId,
    projectId: detail.project.id,
    userId: actor.id,
    actionType: "task_updated",
    content: `${actor.name}将任务“${previousTask?.title ?? "任务"}”更新为${statusLabels[status]}。`,
    createdAt: timestamp,
  };

  return {
    ...detail,
    project: {
      ...detail.project,
      progress: calculateProjectProgress(tasks),
      updatedAt: timestamp,
    },
    tasks,
    activities: [activity, ...detail.activities],
  };
}

export function addMockTaskComment(
  detail: ProjectDetailData,
  taskId: string,
  body: string,
  actor: WorkspaceActor,
  options?: TaskOperationOptions,
): ProjectDetailData {
  const task = detail.tasks.find(({ id }) => id === taskId);
  const normalizedBody = body.trim();
  if (!task) throw new Error("任务不存在");
  if (!normalizedBody) throw new Error("请输入评论内容");

  const timestamp = currentDate(options).toISOString();
  const comment: TaskComment = {
    id: createIdentifier(options),
    organizationId: detail.project.organizationId,
    projectId: detail.project.id,
    taskId,
    authorId: actor.memberId,
    body: normalizedBody,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const activity: ProjectActivity = {
    id: createIdentifier(options),
    organizationId: detail.project.organizationId,
    projectId: detail.project.id,
    userId: actor.id,
    actionType: "task_updated",
    content: `${actor.name}评论了任务“${task.title}”。`,
    createdAt: timestamp,
  };

  return {
    ...detail,
    comments: [...detail.comments, comment],
    activities: [activity, ...detail.activities],
    project: { ...detail.project, updatedAt: timestamp },
  };
}
