import { getActor, getTaskReviewerId } from "@/features/operations/operations-data";
import type { OperationTask, OperationsState } from "@/features/operations/operations-types";
import type {
  MemberSummary,
  ProjectDetailData,
  ProjectTask,
  TaskStatus,
} from "@/features/projects/types";

const organizationId = "demo-organization";

function toMemberSummary(actorId: string): MemberSummary {
  const actor = getActor(actorId);
  return {
    id: actor.memberId,
    displayName: actor.name,
    department: actor.department,
    title: actor.title,
  };
}

function toProjectTaskStatus(task: OperationTask): TaskStatus {
  if (task.status === "assigned" || task.status === "accepted" || task.status === "todo") {
    return "todo";
  }
  if (task.status === "review") return "in_review";
  return task.status;
}

function toProjectTask(
  task: OperationTask,
  createdAt: string,
  sortOrder: number,
): ProjectTask {
  return {
    id: task.id,
    organizationId,
    projectId: task.projectId,
    title: task.title,
    description: task.summary,
    assigneeId: getActor(task.assigneeId).memberId,
    reporterId: getActor(getTaskReviewerId(task)).memberId,
    status: toProjectTaskStatus(task),
    priority: task.priority,
    dueDate: task.dueDate,
    completedAt: task.status === "done" ? task.updatedAt : undefined,
    progress: task.progress,
    estimatedHours: task.estimatedHours,
    sortOrder,
    createdAt,
    updatedAt: task.updatedAt,
  };
}

export function buildOperationProjectDetails(state: OperationsState): ProjectDetailData[] {
  return state.workstreams.flatMap((workstream, workstreamIndex) => {
    const tasks = state.tasks.filter(({ workstreamId }) => workstreamId === workstream.id);
    if (tasks.length === 0) return [];

    const owner = toMemberSummary(workstream.ownerId);
    const memberActorIds = Array.from(new Set([
      workstream.ownerId,
      ...tasks.flatMap((task) => [task.assigneeId, getTaskReviewerId(task)]),
    ]));
    const progress = Math.round(
      tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length,
    );
    const dueDate = tasks.reduce(
      (latest, task) => task.dueDate > latest ? task.dueDate : latest,
      tasks[0].dueDate,
    );
    const updatedAt = tasks.reduce(
      (latest, task) => task.updatedAt > latest ? task.updatedAt : latest,
      workstream.updatedAt,
    );
    const completed = workstream.status !== "active"
      || tasks.every(({ status }) => status === "done");

    return [{
      project: {
        id: workstream.projectId,
        organizationId,
        code: workstream.source === "ai_dispatch"
          ? `AI-DEMO-${workstreamIndex + 1}`
          : `DEPT-DEMO-${workstreamIndex + 1}`,
        name: workstream.title,
        description: workstream.source === "ai_dispatch" ? "AI 调度项目" : "部门协作项目",
        ownerId: owner.id,
        createdById: owner.id,
        status: completed ? "completed" : "active",
        health: tasks.some(({ status }) => status === "blocked") ? "at_risk" : "on_track",
        priority: "high",
        startDate: workstream.createdAt.slice(0, 10),
        dueDate,
        progress,
        createdAt: workstream.createdAt,
        updatedAt,
      },
      owner,
      members: memberActorIds.map((actorId) => ({
        id: `member-${workstream.id}-${actorId}`,
        organizationId,
        projectId: workstream.projectId,
        member: toMemberSummary(actorId),
        role: actorId === workstream.ownerId ? "owner" as const : "member" as const,
        allocationPercent: actorId === workstream.ownerId ? 100 : 50,
        joinedAt: workstream.createdAt,
      })),
      tasks: tasks.map((task, index) => toProjectTask(task, workstream.createdAt, index + 1)),
      milestones: [],
      comments: [],
      files: [],
      dailyReports: [],
      activities: [],
      risks: [],
      fileRelations: [],
    }];
  });
}
