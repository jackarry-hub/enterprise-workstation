import type { AiDispatchPlan } from "@/features/ai-dispatch/dispatch-contract";
import { validateDispatchPlan } from "@/features/ai-dispatch/dispatch-contract";
import { buildDemoTeamContext } from "@/features/ai-dispatch/demo-team-context";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { customerDemoPeople } from "@/features/demo/customer-demo-data";
import {
  requireAuthenticatedActor,
  type OperationFixtureContext,
} from "@/features/operations/operation-actor-compat";
import type { OperationTask, OperationWorkstream } from "@/features/operations/operations-types";
import { createDemoTaskRepository } from "@/features/tasks/repositories/demo-task-repository";

const dispatchRoles = new Set(["executive", "department_head", "finance", "hr"]);

type DispatchOptions = {
  now?: () => Date;
  createId?: () => string;
};

export type AiDispatchReceipt = {
  commandId: string;
  taskCount: number;
  assigneeCount: number;
};

function defaultId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function reviewerFor(
  assigneeName: string,
  requestedOwnerName: string,
  dispatcherActorId: string,
) {
  const assignee = customerDemoPeople.find(({ name }) => name === assigneeName)!;
  const requestedOwner = customerDemoPeople.find(({ name }) => name === requestedOwnerName)!;
  if (requestedOwner.role !== "employee" && requestedOwner.actorId !== assignee.actorId) return requestedOwner;

  const manager = customerDemoPeople.find(({ id }) => id === assignee.managerId);
  if (manager && manager.actorId !== assignee.actorId) return manager;

  const dispatcher = customerDemoPeople.find(({ actorId }) => actorId === dispatcherActorId);
  if (dispatcher && dispatcher.actorId !== assignee.actorId) return dispatcher;

  const independentReviewer = customerDemoPeople.find(({ actorId, role }) => (
    actorId !== assignee.actorId && (role === "executive" || role === "department_head")
  ));
  if (!independentReviewer) throw new Error(`任务“${assigneeName}”未找到独立验收人`);
  return independentReviewer;
}

export async function dispatchAiPlanToOperations(
  context: OperationFixtureContext,
  plan: AiDispatchPlan,
  session: WorkspaceSession,
  options: DispatchOptions = {},
): Promise<AiDispatchReceipt> {
  if (!context.actor || !context.storageNamespace) {
    throw new Error("当前身份未绑定演示任务工作台");
  }
  requireAuthenticatedActor(context, session.actor);
  if (!dispatchRoles.has(session.primaryRole)) {
    throw new Error("当前身份没有 AI 调度权限");
  }

  const validation = validateDispatchPlan(plan, buildDemoTeamContext());
  if (!validation.ok) {
    throw new Error(`AI 调度方案不能下发：${validation.issues.join("；")}`);
  }

  const now = (options.now ?? (() => new Date()))();
  const dispatcherActor = context.actor;
  const createdAt = now.toISOString();
  const token = (options.createId ?? defaultId)();
  const commandId = `ai-command-${token}`;
  const workstreamId = `ai-workstream-${token}`;
  const projectId = `ai-project-${token}`;
  const taskIdByTitle = new Map(plan.tasks.map((task, index) => [
    task.title,
    `ai-task-${token}-${index + 1}`,
  ]));
  const personByName = new Map(customerDemoPeople.map((person) => [person.name, person]));

  const tasks = plan.tasks.map<OperationTask>((task, index) => {
    const assignee = personByName.get(task.assignee)!;
    const reviewer = reviewerFor(task.assignee, task.owner, dispatcherActor.id);
    return {
      id: taskIdByTitle.get(task.title)!,
      code: `AI-${String(index + 1).padStart(2, "0")}`,
      commandId,
      workstreamId,
      projectId,
      department: assignee.department,
      departmentOwnerId: reviewer.actorId,
      assigneeId: assignee.actorId,
      title: task.title,
      summary: task.description,
      acceptance: `提交“${task.title}”的可复核成果，并满足：${task.description}`,
      dueDate: task.deadline,
      priority: task.priority === "urgent" ? "urgent" : task.priority === "high" ? "high" : "medium",
      status: "assigned",
      progress: 0,
      deliverableRequired: true,
      dependencyIds: task.dependencies.map((dependency) => taskIdByTitle.get(dependency)!),
      escalationLevel: "none",
      updatedAt: createdAt,
      runtimeSource: "ai_dispatch",
      projectName: plan.goal,
      creatorId: dispatcherActor.id,
      responsiblePersonId: reviewer.actorId,
      estimatedHours: task.estimated_hours,
      aiReason: task.reason,
      reviewStatus: "not_submitted",
      rejectionCount: 0,
    };
  });

  const command = {
      id: commandId,
      title: plan.goal,
      summary: plan.summary,
      ownerId: dispatcherActor.id,
      status: "executing",
      deadline: tasks.reduce((latest, task) => task.dueDate > latest ? task.dueDate : latest, tasks[0].dueDate),
      budgetWan: 0,
      projectId,
      createdAt,
      updatedAt: createdAt,
  } as const;
  const workstream: OperationWorkstream = {
      id: workstreamId,
      source: "ai_dispatch",
      title: plan.goal,
      ownerId: dispatcherActor.id,
      projectId,
      status: "active",
      createdAt,
      updatedAt: createdAt,
  };
  const dispatchEvent = {
      id: `event-${token}`,
      commandId,
      actorId: dispatcherActor.id,
      actorName: dispatcherActor.name,
      action: "AI 确认下发",
      detail: `${dispatcherActor.name}确认 DeepSeek 调度方案，${tasks.length} 项任务已分配至 ${new Set(tasks.map(({ assigneeId }) => assigneeId)).size} 人的个人工作台。`,
      createdAt,
  };
  const repository = createDemoTaskRepository(context, session);
  await repository.createTasks({ workstream, command, tasks, event: dispatchEvent });

  return {
    commandId,
    taskCount: tasks.length,
    assigneeCount: new Set(tasks.map(({ assigneeId }) => assigneeId)).size,
  };
}
