import { NextResponse } from "next/server";

import {
  canonicalUuid,
  commandFailure,
  publicTaskFromCanonical,
  readStrictJson,
} from "@/app/api/workstation/tasks/handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type TaskAction = "claim" | "progress" | "submit" | "review" | "reopen";
type TaskTransitionInput = {
  taskId: string;
  action: TaskAction;
  expectedVersion: number;
  payload: Record<string, unknown>;
  requestId: string;
};

type TaskSession = { member: { id: number }; roleCodes: readonly string[] };

export type WorkstationTaskDependencies = {
  loadSession: () => Promise<TaskSession | null>;
  mutateTask: (input: TaskTransitionInput) => Promise<unknown>;
};

function cleanText(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return (required && !text) || text.length > maximum ? null : text;
}

function cleanLink(value: unknown) {
  const text = cleanText(value, 2000);
  if (text === null || text === "") return text;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

function exactKeys(body: Record<string, unknown>, allowed: readonly string[]) {
  const keys = Object.keys(body).sort();
  return keys.length === allowed.length && [...allowed].sort().every((key, index) => key === keys[index]);
}

function parseTransition(value: unknown): Omit<TaskTransitionInput, "taskId" | "requestId"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.action !== "string" || !["claim", "progress", "submit", "review", "reopen"].includes(body.action)
    || typeof body.expectedVersion !== "number" || !Number.isSafeInteger(body.expectedVersion)
    || body.expectedVersion < 1) return null;
  const action = body.action as TaskAction;
  if (action === "claim") {
    return exactKeys(body, ["action", "expectedVersion"])
      ? { action, expectedVersion: body.expectedVersion, payload: {} } : null;
  }
  if (action === "progress") {
    if (!exactKeys(body, ["action", "expectedVersion", "progress", "blocker", "nextStep"])
      || typeof body.progress !== "number" || !Number.isFinite(body.progress)
      || body.progress < 0 || body.progress > 100) return null;
    const blocker = cleanText(body.blocker, 2000);
    const nextStep = cleanText(body.nextStep, 2000);
    return blocker === null || nextStep === null ? null : {
      action, expectedVersion: body.expectedVersion,
      payload: { progress: body.progress, blocker, nextStep },
    };
  }
  if (action === "submit") {
    if (!exactKeys(body, ["action", "expectedVersion", "resultText", "resultLink", "resultFiles"])) return null;
    const resultText = cleanText(body.resultText, 4000, true);
    const resultLink = cleanLink(body.resultLink);
    const resultFiles = Array.isArray(body.resultFiles)
      ? body.resultFiles.map((item) => cleanText(item, 240, true)) : null;
    if (!resultText || resultLink === null || !resultFiles || resultFiles.length > 10
      || resultFiles.some((item) => item === null) || (!resultLink && resultFiles.length === 0)) return null;
    return {
      action, expectedVersion: body.expectedVersion,
      payload: { resultText, resultLink, resultFiles: resultFiles as string[] },
    };
  }
  if (action === "review") {
    if (!exactKeys(body, ["action", "expectedVersion", "decision", "note"])) return null;
    const note = cleanText(body.note, 2000);
    if ((body.decision !== "pass" && body.decision !== "reject") || note === null
      || (body.decision === "reject" && !note)) return null;
    return {
      action, expectedVersion: body.expectedVersion,
      payload: { decision: body.decision, note },
    };
  }
  if (!exactKeys(body, ["action", "expectedVersion", "note"])) return null;
  const note = cleanText(body.note, 2000);
  return note === null ? null : { action, expectedVersion: body.expectedVersion, payload: { note } };
}

export const defaultWorkstationTaskDependencies: WorkstationTaskDependencies = {
  loadSession: getWorkspaceSession,
  async mutateTask(input) {
    const client = await getSupabaseServerClient();
    const { data, error } = await client.rpc("transition_current_task", {
      task_public_id: input.taskId,
      command: input.action,
      expected_version: input.expectedVersion,
      payload: input.payload,
      request_id: input.requestId,
    });
    if (error) throw error;
    return data;
  },
};

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function failureStatus(error: string) {
  if (error === "not_found") return 404;
  if (error === "forbidden") return 403;
  if (["version_conflict", "invalid_transition", "scope_conflict", "conflict"].includes(error)) return 409;
  return 503;
}

function parseTransitionSuccess(value: unknown, taskId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const command = value as Record<string, unknown>;
  const task = publicTaskFromCanonical(command.entity);
  if (command.outcome !== "success" || command.resource !== "task"
    || canonicalUuid(command.id) !== taskId || !task
    || command.version !== task.version || task.id !== taskId) return null;
  return task;
}

export function createWorkstationTaskHandler(dependencies: WorkstationTaskDependencies) {
  return async function updateTask(request: Request, context: { params: Promise<{ taskId: string }> }) {
    const session = await dependencies.loadSession();
    if (!session) return json("unauthorized", 401);
    const { taskId: rawTaskId } = await context.params;
    const taskId = canonicalUuid(rawTaskId);
    if (!taskId) return json("invalid_task", 400);
    const requestId = canonicalUuid(request.headers.get("Idempotency-Key"));
    if (!requestId) return json("invalid_idempotency_key", 400);
    const parsedBody = await readStrictJson(request);
    if (!parsedBody.ok) {
      return json(parsedBody.error, parsedBody.error === "unsupported_media_type" ? 415
        : parsedBody.error === "payload_too_large" ? 413 : 400);
    }
    const transition = parseTransition(parsedBody.value);
    if (!transition) return json("invalid_request", 400);
    let result: unknown;
    try {
      result = await dependencies.mutateTask({ taskId, ...transition, requestId });
    } catch {
      return json("task_transition_unavailable", 503);
    }
    const failure = commandFailure(result);
    if (failure) return json(failure, failureStatus(failure));
    const task = parseTransitionSuccess(result, taskId);
    if (!task) return json("task_transition_unavailable", 503);
    return NextResponse.json({ task });
  };
}
