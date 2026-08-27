import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  canonicalUuid,
  commandFailure,
  parseTaskBatchCommand,
  parseTaskCreate,
  readStrictJson,
  type TaskBatchCommandInput,
  type TaskCreateSession,
} from "@/app/api/workstation/tasks/handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import {
  dispatchTaskAssignmentBatch,
  type TaskNotificationBatchResult,
  type TaskNotificationBatchScope,
} from "@/features/workstation/task-notification-batch";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type WorkstationTaskBatchDependencies = {
  loadSession: () => Promise<TaskCreateSession | null>;
  createBatch: (input: TaskBatchCommandInput) => Promise<unknown>;
  notifyTasks: (scopes: TaskNotificationBatchScope[]) => Promise<Record<string, TaskNotificationBatchResult>>;
};

export const defaultWorkstationTaskBatchDependencies: WorkstationTaskBatchDependencies = {
  loadSession: getWorkspaceSession,
  async createBatch(input) {
    const client = await getSupabaseServerClient();
    const { data, error } = await client.rpc("create_current_task_batch_v3", {
      items: input.items,
      idempotency_key: input.idempotencyKey,
      request_id: input.requestId,
    });
    if (error) throw error;
    return data;
  },
  notifyTasks: dispatchTaskAssignmentBatch,
};

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function failureStatus(error: string) {
  if (error === "forbidden") return 403;
  if (error === "not_found") return 404;
  if (["scope_conflict", "conflict"].includes(error)) return 409;
  return 503;
}

export function createWorkstationTaskBatchHandler(dependencies: WorkstationTaskBatchDependencies) {
  return async function createTaskBatch(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) return json("unauthorized", 401);
    const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
    if (!idempotencyKey) return json("invalid_idempotency_key", 400);
    const parsedBody = await readStrictJson(request);
    if (!parsedBody.ok) {
      return json(parsedBody.error, parsedBody.error === "unsupported_media_type" ? 415
        : parsedBody.error === "payload_too_large" ? 413 : 400);
    }
    if (!parsedBody.value || typeof parsedBody.value !== "object" || Array.isArray(parsedBody.value)) {
      return json("invalid_request", 400);
    }
    const body = parsedBody.value as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== "tasks")
      || !Array.isArray(body.tasks) || body.tasks.length < 1 || body.tasks.length > 20) {
      return json("invalid_request", 400);
    }
    const items = body.tasks.map(parseTaskCreate);
    if (items.some((item) => item === null)) return json("invalid_request", 400);
    let result: unknown;
    try {
      result = await dependencies.createBatch({
        items: items as NonNullable<(typeof items)[number]>[],
        idempotencyKey,
        requestId: randomUUID(),
      });
    } catch {
      return json("task_batch_unavailable", 503);
    }
    const failure = commandFailure(result);
    if (failure) return json(failure, failureStatus(failure));
    const parsed = parseTaskBatchCommand(result, items.length, idempotencyKey);
    if (!parsed) return json("task_batch_unavailable", 503);
    const scopes = parsed.taskIds.map((taskId) => ({
      tenantId: session.tenantId, organizationId: session.organization.id, taskId,
    }));
    let notifications: Record<string, TaskNotificationBatchResult>;
    try {
      notifications = await dependencies.notifyTasks(scopes);
    } catch {
      notifications = Object.fromEntries(scopes.map(({ taskId }) => [
        taskId, { status: "failed", errorCode: "send_failed" },
      ]));
    }
    return NextResponse.json({
      tasks: parsed.tasks.map((task) => ({
        task,
        notification: notifications[task.id] ?? { status: "failed", errorCode: "send_failed" },
      })),
    }, { status: 201 });
  };
}

export const POST = createWorkstationTaskBatchHandler(defaultWorkstationTaskBatchDependencies);
