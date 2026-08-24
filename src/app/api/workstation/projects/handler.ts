import { NextResponse } from "next/server";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

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

function projectCreateErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code?: unknown }).code;
  }
  return null;
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
    const client = getSupabaseServiceRoleClient();

    const { data: organization, error: organizationError } = await client.from("organizations")
      .select("id")
      .eq("public_id", input.organizationId)
      .maybeSingle();
    if (organizationError || !organization) {
      throw organizationError ?? new Error("project_organization_invalid");
    }
    const organizationId = organization.id;

    const { data: owner, error: ownerError } = await client.from("organization_members")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", input.ownerMemberId)
      .in("status", ["invited", "active"])
      .maybeSingle();
    if (ownerError || !owner) throw ownerError ?? new Error("project_member_invalid");

    const { data: actor, error: actorError } = await client.from("organization_members")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", input.actorMemberId)
      .eq("status", "active")
      .maybeSingle();
    if (actorError || !actor) throw actorError ?? new Error("project_actor_invalid");

    const projectCode = `QXY-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const { data: project, error: projectError } = await client.from("projects")
      .insert({
        organization_id: organizationId,
        code: projectCode,
        name: input.name,
        description: input.description,
        owner_member_id: input.ownerMemberId,
        created_by_member_id: input.actorMemberId,
        status: "active",
        health: "on_track",
        priority: "medium",
        start_date: input.startDate,
        due_date: input.dueDate,
        progress: 0,
      })
      .select("id, public_id")
      .single();
    if (projectError || !project) throw projectError ?? new Error("project_create_failed");

    const projectMembers = [{
      organization_id: organizationId,
      project_id: project.id,
      member_id: input.ownerMemberId,
      role: "owner",
      allocation_percent: 100,
    }];
    if (input.actorMemberId !== input.ownerMemberId) {
      projectMembers.push({
        organization_id: organizationId,
        project_id: project.id,
        member_id: input.actorMemberId,
        role: "manager",
        allocation_percent: 100,
      });
    }

    const { error: membersError } = await client.from("project_members").insert(projectMembers);
    if (membersError) throw membersError;

    return {
      id: String(project.public_id),
      n: input.name,
      own: `m${input.ownerMemberId}`,
      cat: input.category || "企业项目",
      pr: 0,
      bud: input.budgetWan,
      health: 90,
      st: "进行中",
      up: new Date().toISOString(),
      pri: "medium",
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
      const code = projectCreateErrorCode(error);
      console.error("[workstation.projects.create]", {
        code,
        message: error instanceof Error ? error.message : "project_create_failed",
      });
      if (code === "42501") {
        return NextResponse.json({ error: "project_create_forbidden" }, { status: 403 });
      }
      if (error instanceof Error && error.message === "project_member_invalid") {
        return NextResponse.json({ error: "project_member_invalid" }, { status: 400 });
      }
      return NextResponse.json({ error: "project_create_failed" }, { status: 409 });
    }
  };
}
