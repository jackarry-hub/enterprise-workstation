import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import type { AiExecutionSummary } from "@/features/ai-dispatch/summary-contract";
import {
  requireAuthenticatedActor,
  type OperationFixtureContext,
} from "@/features/operations/operation-actor-compat";
import {
  readOperationsState,
  saveOperationsState,
  updateOperationTask,
} from "@/features/operations/operations-data";
import { createDemoIdleCommand } from "@/features/operations/department-demo-seed";
import type {
  RuntimeDispatchWrite,
  RuntimeTaskSubmissionInput,
  TaskRepository,
} from "@/features/tasks/repositories/task-repository";

export class DemoTaskRepository implements TaskRepository {
  constructor(
    private readonly context: OperationFixtureContext,
    private readonly session: WorkspaceSession,
  ) {}

  async createTasks(input: RuntimeDispatchWrite) {
    requireAuthenticatedActor(this.context, this.session.actor);
    if (!this.context.actor || !this.context.storageNamespace) {
      throw new Error("当前身份未绑定演示任务工作台");
    }
    const current = readOperationsState(this.context);
    if (input.workstream.source !== "ai_dispatch") {
      throw new Error("运行时调度必须写入 AI 工作流");
    }
    if (input.tasks.length === 0 || input.tasks.some((task) => (
      task.runtimeSource !== "ai_dispatch"
      || task.workstreamId !== input.workstream.id
      || task.projectId !== input.workstream.projectId
      || task.commandId !== input.command.id
    ))) {
      throw new Error("AI 调度任务与工作流归属不一致");
    }
    const activeAiId = current.activeAiWorkstreamId;
    const retainedTasks = current.tasks.filter(
      (task) => !activeAiId || task.workstreamId !== activeAiId,
    );
    const retainedWorkstreams = current.workstreams.filter(
      (workstream) => workstream.id !== activeAiId,
    );
    const retainedTaskIds = new Set(retainedTasks.map(({ id }) => id));
    const dispatchTaskIds = new Set(input.tasks.map(({ id }) => id));
    if (dispatchTaskIds.size !== input.tasks.length || input.tasks.some(({ id }) => retainedTaskIds.has(id))) {
      throw new Error("AI 调度任务 ID 重复");
    }
    if (retainedWorkstreams.some(({ id }) => id === input.workstream.id)) {
      throw new Error("AI 调度工作流 ID 重复");
    }
    return saveOperationsState(this.context, {
      ...current,
      command: input.command,
      activeAiWorkstreamId: input.workstream.id,
      workstreams: [...retainedWorkstreams, input.workstream],
      tasks: [...retainedTasks, ...input.tasks],
      events: [input.event, ...current.events],
    });
  }

  async getTasks() {
    return readOperationsState(this.context).tasks;
  }

  async getTasksByUser(actorId: string) {
    return (await this.getTasks()).filter(({ assigneeId }) => assigneeId === actorId);
  }

  async acceptTask(taskId: string) {
    return updateOperationTask(this.context, taskId, {
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    }, this.actorId(), this.session.actor);
  }

  async startTask(taskId: string) {
    return updateOperationTask(this.context, taskId, {
      status: "in_progress",
      progress: 20,
      startedAt: new Date().toISOString(),
    }, this.actorId(), this.session.actor);
  }

  async updateProgress(taskId: string, progress: number) {
    if (!Number.isInteger(progress) || progress < 1 || progress > 89) {
      throw new Error("执行进度必须是 1 到 89 的整数");
    }
    return updateOperationTask(this.context, taskId, { progress }, this.actorId(), this.session.actor);
  }

  async submitTask(taskId: string, submission: RuntimeTaskSubmissionInput) {
    if (![submission.description, submission.url, submission.attachmentName].some((value) => value?.trim())) {
      throw new Error("提交验收前请填写成果说明、URL 或模拟附件名");
    }
    return updateOperationTask(this.context, taskId, {
      status: "review",
      submission: {
        description: submission.description.trim(),
        url: submission.url?.trim() || undefined,
        attachmentName: submission.attachmentName?.trim() || undefined,
        note: submission.note?.trim() || undefined,
        submittedAt: new Date().toISOString(),
      },
      reviewStatus: "pending",
      reviewComment: undefined,
      reviewedById: undefined,
      reviewedAt: undefined,
    }, this.actorId(), this.session.actor);
  }

  async approveTask(taskId: string, comment: string) {
    if (!comment.trim()) throw new Error("验收通过必须填写验收意见");
    return updateOperationTask(this.context, taskId, {
      status: "done",
      reviewNote: comment.trim(),
      reviewStatus: "approved",
      reviewComment: comment.trim(),
      reviewedById: this.actorId(),
      reviewedAt: new Date().toISOString(),
    }, this.actorId(), this.session.actor);
  }

  async rejectTask(taskId: string, reason: string) {
    if (!reason.trim()) throw new Error("退回修改必须填写原因");
    const task = readOperationsState(this.context).tasks.find(({ id }) => id === taskId);
    if (!task) throw new Error("未找到任务");
    return updateOperationTask(this.context, taskId, {
      status: "in_progress",
      progress: 70,
      reviewNote: reason.trim(),
      reviewStatus: "rejected",
      reviewComment: reason.trim(),
      reviewedById: this.actorId(),
      reviewedAt: new Date().toISOString(),
      rejectionCount: (task.rejectionCount ?? 0) + 1,
    }, this.actorId(), this.session.actor);
  }

  async resetActiveAiDispatch() {
    const actorId = this.actorId();
    const state = readOperationsState(this.context);
    const activeId = state.activeAiWorkstreamId;
    if (!activeId) return state;
    if (state.command.ownerId !== actorId && this.session.primaryRole !== "executive") {
      throw new Error("只有本次调度发起人或决策人可以重置 AI 调度");
    }
    return saveOperationsState(this.context, {
      ...state,
      activeAiWorkstreamId: undefined,
      workstreams: state.workstreams.filter(({ id }) => id !== activeId),
      tasks: state.tasks.filter(({ workstreamId }) => workstreamId !== activeId),
      command: createDemoIdleCommand(),
    });
  }

  async saveDispatchSummary(summary: AiExecutionSummary, model: string) {
    const actorId = this.actorId();
    const state = readOperationsState(this.context);
    const activeTasks = state.activeAiWorkstreamId
      ? state.tasks.filter(({ workstreamId }) => workstreamId === state.activeAiWorkstreamId)
      : [];
    if (state.command.ownerId !== actorId) throw new Error("只有本次调度发起人可以生成执行总结");
    if (state.command.status !== "accepted" || activeTasks.length === 0 || activeTasks.some(({ status }) => status !== "done")) {
      throw new Error("所有任务验收完成后才能生成 AI 总结");
    }
    const timestamp = new Date().toISOString();
    return saveOperationsState(this.context, {
      ...state,
      command: {
        ...state.command,
        aiSummary: summary,
        summaryModel: model,
        summaryGeneratedAt: timestamp,
        updatedAt: timestamp,
      },
      events: [{
        id: `event-summary-${Date.now()}`,
        commandId: state.command.id,
        actorId,
        actorName: this.context.actor!.name,
        action: "生成 AI 执行总结",
        detail: `DeepSeek 已完成“${state.command.title}”执行复盘。`,
        createdAt: timestamp,
      }, ...state.events],
    });
  }

  async archiveDispatch() {
    const actorId = this.actorId();
    const state = readOperationsState(this.context);
    if (state.command.ownerId !== actorId) throw new Error("只有本次调度发起人可以归档");
    if (state.command.status !== "accepted" || !state.command.aiSummary || !state.command.summaryModel) {
      throw new Error("请先完成所有任务并生成 AI 总结");
    }
    const activeId = state.activeAiWorkstreamId;
    const activeTasks = activeId
      ? state.tasks.filter(({ workstreamId }) => workstreamId === activeId)
      : [];
    if (!activeId || activeTasks.length === 0 || activeTasks.some(({ status }) => status !== "done")) {
      throw new Error("当前没有可归档的已完成 AI 调度");
    }
    const archivedAt = new Date().toISOString();
    const participantCount = new Set(activeTasks.map(({ assigneeId }) => assigneeId)).size;
    const rejectionCount = activeTasks.reduce((sum, task) => sum + (task.rejectionCount ?? 0), 0);
    const entry = {
      commandId: state.command.id,
      goal: state.command.title,
      creatorId: state.command.ownerId,
      taskCount: activeTasks.length,
      participantCount,
      rejectionCount,
      completedAt: state.command.updatedAt,
      archivedAt,
      aiSummary: state.command.aiSummary,
      summaryModel: state.command.summaryModel,
      tasks: activeTasks,
    };
    return saveOperationsState(this.context, {
      ...state,
      activeAiWorkstreamId: undefined,
      command: { ...state.command, status: "archived", archivedAt, updatedAt: archivedAt },
      workstreams: state.workstreams.map((workstream) => workstream.id === activeId
        ? { ...workstream, status: "archived" as const, updatedAt: archivedAt }
        : workstream),
      dispatchHistory: [entry, ...state.dispatchHistory.filter(({ commandId }) => commandId !== state.command.id)],
      events: [{
        id: `event-archive-${Date.now()}`,
        commandId: state.command.id,
        actorId,
        actorName: this.context.actor!.name,
        action: "归档 AI 调度",
        detail: `“${state.command.title}”已归档至 AI 调度历史。`,
        createdAt: archivedAt,
      }, ...state.events],
    });
  }

  private actorId() {
    if (!this.context.actor) throw new Error("当前身份未绑定演示任务工作台");
    requireAuthenticatedActor(this.context, this.session.actor);
    return this.context.actor.id;
  }
}

export function createDemoTaskRepository(
  context: OperationFixtureContext,
  session: WorkspaceSession,
) {
  return new DemoTaskRepository(context, session);
}
