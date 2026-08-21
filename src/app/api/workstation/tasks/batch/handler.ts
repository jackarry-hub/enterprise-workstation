import { NextResponse } from "next/server";

import {
  defaultWorkstationTaskCreateDependencies,
  parseTaskCreate,
  type TaskCreateInput,
  type TaskCreateSession,
} from "@/app/api/workstation/tasks/handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import {
  dispatchTaskAssignmentBatch,
  type TaskNotificationBatchResult,
  type TaskNotificationBatchScope,
} from "@/features/workstation/task-notification-batch";

type WorkstationTaskBatchDependencies = {
  loadSession: () => Promise<TaskCreateSession | null>;
  createTask: (input: TaskCreateInput) => Promise<unknown>;
  notifyTasks: (
    scopes: TaskNotificationBatchScope[],
  ) => Promise<Record<string, TaskNotificationBatchResult>>;
};

const defaultDependencies: WorkstationTaskBatchDependencies = {
  loadSession: getWorkspaceSession,
  createTask: defaultWorkstationTaskCreateDependencies.createTask,
  notifyTasks: dispatchTaskAssignmentBatch,
};

export function createWorkstationTaskBatchHandler(
  dependencies: WorkstationTaskBatchDependencies,
) {
  return async function createTaskBatch(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!session.permissionCodes.includes("task.manage")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const tasks = body && typeof body === "object" && !Array.isArray(body)
      ? (body as { tasks?: unknown }).tasks
      : null;
    if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 20) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const parsed = tasks.map(parseTaskCreate);
    if (parsed.some((task) => task === null)) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const created: unknown[] = [];
    try {
      for (const task of parsed) {
        created.push(await dependencies.createTask({
          actorMemberId: session.member.id,
          ...task!,
        }));
      }
    } catch {
      return NextResponse.json({ error: "task_create_failed" }, { status: 409 });
    }

    const scopes = created.map((task) => ({
      tenantId: session.tenantId,
      organizationId: session.organization.id,
      taskId: String((task as { id: unknown }).id),
    }));
    let notifications: Record<string, TaskNotificationBatchResult>;
    try {
      notifications = await dependencies.notifyTasks(scopes);
    } catch {
      notifications = Object.fromEntries(scopes.map(({ taskId }) => [
        taskId,
        { status: "failed", errorCode: "send_failed" },
      ]));
    }

    return NextResponse.json({
      tasks: created.map((task) => {
        const taskId = String((task as { id: unknown }).id);
        return {
          task,
          notification: notifications[taskId] ?? {
            status: "failed",
            errorCode: "send_failed",
          },
        };
      }),
    }, { status: 201 });
  };
}

export const POST = createWorkstationTaskBatchHandler(defaultDependencies);
