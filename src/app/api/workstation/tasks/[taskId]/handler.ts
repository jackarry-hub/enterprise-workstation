import { NextResponse } from "next/server";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGER_ROLES = new Set(["owner", "admin", "department_head"]);

type TaskAction = "claim" | "progress" | "submit" | "review" | "reopen";
type TaskMutation = {
  taskId: string;
  actorMemberId: number;
  roleCodes: readonly string[];
  action: TaskAction;
  progress?: number;
  blocker?: string;
  nextStep?: string;
  resultText?: string;
  resultLink?: string;
  resultFiles?: string[];
  decision?: "pass" | "reject";
  note?: string;
};

type TaskSession = {
  member: { id: number };
  roleCodes: readonly string[];
};

export type WorkstationTaskDependencies = {
  loadSession: () => Promise<TaskSession | null>;
  mutateTask: (input: TaskMutation) => Promise<unknown>;
};

function cleanText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length <= maximum ? text : null;
}

function cleanLink(value: unknown) {
  const text = cleanText(value, 2000);
  if (text === null || text === "") return text;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function parseMutation(value: unknown): Omit<TaskMutation, "taskId" | "actorMemberId" | "roleCodes"> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!["claim", "progress", "submit", "review", "reopen"].includes(String(body.action))) return null;
  const action = body.action as TaskAction;

  if (action === "claim") return { action };
  if (action === "progress") {
    const progress = Number(body.progress);
    const blocker = cleanText(body.blocker ?? "", 2000);
    const nextStep = cleanText(body.nextStep ?? "", 2000);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100 || blocker === null || nextStep === null) return null;
    return { action, progress, blocker, nextStep };
  }
  if (action === "submit") {
    const resultText = cleanText(body.resultText, 4000);
    const resultLink = cleanLink(body.resultLink ?? "");
    const resultFiles = Array.isArray(body.resultFiles)
      ? body.resultFiles.map((item) => cleanText(item, 240))
      : [];
    if (!resultText || resultLink === null || resultFiles.length > 10 || resultFiles.some((item) => item === null) || (!resultLink && resultFiles.length === 0)) return null;
    return { action, resultText, resultLink, resultFiles: resultFiles as string[] };
  }
  if (action === "review") {
    const decision = body.decision;
    const note = cleanText(body.note ?? "", 2000);
    if ((decision !== "pass" && decision !== "reject") || note === null || (decision === "reject" && !note)) return null;
    return { action, decision, note };
  }
  const note = cleanText(body.note ?? "", 2000);
  return note === null ? null : { action, note };
}

function publicStatus(value: string) {
  return ({ backlog: "待处理", todo: "待处理", in_progress: "进行中", in_review: "待验收", done: "已完成", cancelled: "已取消" } as Record<string, string>)[value] ?? "待处理";
}

function publicTask(row: Record<string, unknown>) {
  return {
    id: row.public_id,
    own: row.assignee_member_id == null ? "" : `m${row.assignee_member_id}`,
    st: publicStatus(String(row.status)),
    pr: Number(row.progress),
    blocker: String(row.blocker ?? ""),
    nextStep: String(row.next_step ?? ""),
    resultText: String(row.result_summary ?? ""),
    resultLink: String(row.result_link ?? ""),
    resultFiles: Array.isArray(row.result_files) ? row.result_files : [],
    reviewNote: String(row.review_note ?? ""),
  };
}

export const defaultWorkstationTaskDependencies: WorkstationTaskDependencies = {
  loadSession: getWorkspaceSession,
  async mutateTask(input) {
    const client = await getSupabaseServerClient();
    const { data: current, error: readError } = await client.from("tasks")
      .select("public_id, assignee_member_id, reporter_member_id, status, progress")
      .eq("public_id", input.taskId)
      .is("deleted_at", null)
      .single();
    if (readError || !current) throw new Error("task_not_found");

    const isManager = input.roleCodes.some((role) => MANAGER_ROLES.has(role));
    const isAssignee = current.assignee_member_id === input.actorMemberId;
    const isReporter = current.reporter_member_id === input.actorMemberId;
    const expectedStatus = current.status;
    const now = new Date().toISOString();
    let changes: Record<string, unknown>;

    if (input.action === "claim") {
      if (current.assignee_member_id !== null || !["backlog", "todo"].includes(current.status)) throw new Error("forbidden");
      changes = { assignee_member_id: input.actorMemberId, status: "in_progress", start_date: now.slice(0, 10) };
    } else if (input.action === "progress") {
      if (!isAssignee || current.status !== "in_progress") throw new Error("forbidden");
      changes = { progress: input.progress, blocker: input.blocker || null, next_step: input.nextStep ?? "" };
    } else if (input.action === "submit") {
      if (!isAssignee || current.status !== "in_progress") throw new Error("forbidden");
      changes = {
        status: "in_review",
        result_summary: input.resultText,
        result_link: input.resultLink ?? "",
        result_files: input.resultFiles ?? [],
        submitted_at: now,
      };
    } else if (input.action === "review") {
      if ((!isReporter && !isManager) || current.status !== "in_review") throw new Error("forbidden");
      changes = {
        status: input.decision === "pass" ? "done" : "in_progress",
        progress: input.decision === "pass" ? 100 : current.progress,
        review_note: input.note ?? "",
        reviewed_at: now,
        completed_at: input.decision === "pass" ? now : null,
      };
    } else {
      if ((!isReporter && !isManager) || current.status !== "done") throw new Error("forbidden");
      changes = {
        status: "in_progress",
        progress: Math.min(95, Number(current.progress)),
        review_note: input.note ?? "",
        reviewed_at: now,
        completed_at: null,
      };
    }

    let update = client.from("tasks")
      .update(changes)
      .eq("public_id", input.taskId)
      .eq("status", expectedStatus)
      .is("deleted_at", null);
    if (input.action === "claim") update = update.is("assignee_member_id", null);
    const { data, error } = await update
      .select("public_id, assignee_member_id, status, progress, blocker, next_step, result_summary, result_link, result_files, review_note")
      .single();
    if (error || !data) throw new Error("task_update_failed");
    return publicTask(data as Record<string, unknown>);
  },
};

export function createWorkstationTaskHandler(
  dependencies: WorkstationTaskDependencies,
) {
  return async function updateTask(
    request: Request,
    context: { params: Promise<{ taskId: string }> },
  ) {
    const session = await dependencies.loadSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { taskId } = await context.params;
    if (!UUID_PATTERN.test(taskId)) return NextResponse.json({ error: "invalid_task" }, { status: 400 });
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }
    const mutation = parseMutation(body);
    if (!mutation) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    try {
      const task = await dependencies.mutateTask({
        taskId,
        actorMemberId: session.member.id,
        roleCodes: session.roleCodes,
        ...mutation,
      });
      return NextResponse.json({ task });
    } catch {
      return NextResponse.json({ error: "task_update_failed" }, { status: 409 });
    }
  };
}
