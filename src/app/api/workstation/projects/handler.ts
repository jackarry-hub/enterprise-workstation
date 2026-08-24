import { NextResponse } from "next/server";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ProjectCreateSession = {
  organization: { id: string };
  member: { id: number };
  permissionCodes: readonly string[];
};

export type ProjectCreateInput = {
  actorMemberId: number;
  organizationId: string;
  ownerMemberId: number;
  name: string;
  category: string;
  description: string;
  startDate: string;
  dueDate: string;
  budgetWan: number;
};

export type WorkstationProjectCreateDependencies = {
  loadSession: () => Promise<ProjectCreateSession | null>;
  createProject: (input: ProjectCreateInput) => Promise<unknown>;
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

function date(value: unknown) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

function budgetWan(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999999) return 0;
  return parsed;
}

export function parseProjectCreate(
  value: unknown,
): Omit<ProjectCreateInput, "actorMemberId" | "organizationId"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const name = text(body.name, 240, true);
  const ownerMemberId = memberId(body.ownerMemberId);
  const category = text(body.category ?? "企业项目", 80) ?? "企业项目";
  const description = text(body.description ?? "", 4000) ?? "";
  const startDate = date(body.startDate);
  const dueDate = date(body.dueDate);
  if (!name || !ownerMemberId || !startDate || !dueDate || startDate > dueDate) {
    return null;
  }
  return {
    ownerMemberId,
    name,
    category,
    description,
    startDate,
    dueDate,
    budgetWan: budgetWan(body.budgetWan),
  };
}

export const defaultWorkstationProjectCreateDependencies: WorkstationProjectCreateDependencies = {
  loadSession: getWorkspaceSession,
  async createProject(input) {
    const client = await getSupabaseServerClient();
    const { data: publicId, error: rpcError } = await client.rpc("create_current_project", {
      p_name: input.name,
      p_description: input.description,
      p_owner_member_id: input.ownerMemberId,
      p_member_ids: [],
      p_status: "active",
      p_priority: "medium",
      p_start_date: input.startDate,
      p_due_date: input.dueDate,
    });

    if (rpcError || !publicId) throw rpcError ?? new Error("project_create_failed");

    const { data, error } = await client.from("projects")
      .select("public_id, name, owner_member_id, progress, health, status, priority, updated_at")
      .eq("public_id", publicId)
      .single();

    if (error || !data) throw error ?? new Error("project_create_failed");

    return {
      id: data.public_id,
      n: data.name,
      own: `m${data.owner_member_id}`,
      cat: input.category || "企业项目",
      pr: Number(data.progress ?? 0),
      bud: input.budgetWan,
      health: data.health === "on_track" ? 90 : data.health === "at_risk" ? 65 : 35,
      st: data.status === "completed" ? "已完成" : data.status === "on_hold" ? "风险" : "进行中",
      up: data.updated_at,
      pri: data.priority,
    };
  },
};

export function createWorkstationProjectCreateHandler(
  dependencies: WorkstationProjectCreateDependencies,
) {
  return async function createProject(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!session.permissionCodes.includes("project.manage")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const input = parseProjectCreate(body);
    if (!input) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

    try {
      const project = await dependencies.createProject({
        actorMemberId: session.member.id,
        organizationId: session.organization.id,
        ...input,
      });
      return NextResponse.json({ project }, { status: 201 });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error
        && error.code === "42501") {
        return NextResponse.json({ error: "project_create_forbidden" }, { status: 403 });
      }
      return NextResponse.json({ error: "project_create_failed" }, { status: 409 });
    }
  };
}
