import { NextResponse } from "next/server";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = { P0: "urgent", P1: "high", P2: "medium" } as const;

type TaskCreateSession = {
  member: { id: number };
  permissionCodes: readonly string[];
};

type TaskCreateInput = {
  actorMemberId: number;
  projectId: string;
  assigneeMemberId: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
  dueDate: string;
  priority: "urgent" | "high" | "medium";
};

export type WorkstationTaskCreateDependencies = {
  loadSession: () => Promise<TaskCreateSession | null>;
  createTask: (input: TaskCreateInput) => Promise<unknown>;
};

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  if ((required && !parsed) || parsed.length > maximum) return null;
  return parsed;
}

function memberId(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^m([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseTaskCreate(value: unknown): Omit<TaskCreateInput, "actorMemberId"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const projectId = typeof body.projectId === "string" && UUID_PATTERN.test(body.projectId)
    ? body.projectId
    : null;
  const assigneeMemberId = memberId(body.assigneeMemberId);
  const title = text(body.title, 240, true);
  const description = text(body.description ?? "", 4000);
  const acceptanceCriteria = text(body.acceptanceCriteria, 2000, true);
  const dueDate = typeof body.dueDate === "string" && DATE_PATTERN.test(body.dueDate)
    && !Number.isNaN(Date.parse(`${body.dueDate}T00:00:00Z`))
    ? body.dueDate
    : null;
  const priority = typeof body.priority === "string"
    ? PRIORITIES[body.priority as keyof typeof PRIORITIES]
    : null;
  if (!projectId || !assigneeMemberId || title === null || description === null
    || acceptanceCriteria === null || !dueDate || !priority) return null;
  return { projectId, assigneeMemberId, title, description, acceptanceCriteria, dueDate, priority };
}

const publicPriorities = { urgent: "P0", high: "P1", medium: "P2" } as const;

export const defaultWorkstationTaskCreateDependencies: WorkstationTaskCreateDependencies = {
  loadSession: getWorkspaceSession,
  async createTask(input) {
    const client = await getSupabaseServerClient();
    const { data, error } = await client.rpc("create_current_project_task_v2", {
      p_project_public_id: input.projectId,
      p_title: input.title,
      p_description: input.description,
      p_assignee_member_id: input.assigneeMemberId,
      p_due_date: input.dueDate,
      p_priority: input.priority,
      p_acceptance_criteria: input.acceptanceCriteria,
    });
    if (error || typeof data !== "string") throw error ?? new Error("task_create_failed");
    return {
      id: data,
      n: input.title,
      p: input.projectId,
      own: `m${input.assigneeMemberId}`,
      createdBy: `m${input.actorMemberId}`,
      reviewer: `m${input.actorMemberId}`,
      role: "",
      pri: publicPriorities[input.priority],
      st: "待处理",
      s: new Date().toISOString().slice(0, 10),
      e: input.dueDate,
      pr: 0,
      description: input.description,
      ac: input.acceptanceCriteria,
      blocker: "",
      reviewNote: "",
      nextStep: "",
      resultText: "",
      resultLink: "",
      resultFiles: [],
      timeline: [],
      src: "飞书工作站",
      dep: [],
    };
  },
};

export function createWorkstationTaskCreateHandler(
  dependencies: WorkstationTaskCreateDependencies,
) {
  return async function createTask(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!session.permissionCodes.includes("task.manage")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }
    const input = parseTaskCreate(body);
    if (!input) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    try {
      const task = await dependencies.createTask({ actorMemberId: session.member.id, ...input });
      return NextResponse.json({ task }, { status: 201 });
    } catch {
      return NextResponse.json({ error: "task_create_failed" }, { status: 409 });
    }
  };
}
