import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import {
  parseWorkProfileInput,
  type WorkProfileInput,
} from "@/features/work-profile/work-profile-schema";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type WorkProfileSession = {
  member: { status: "active" };
};

type WorkProfileCommandResult =
  | { outcome: "success"; profile: unknown }
  | { outcome: "failure"; error: "profile_not_found" | "conflict" };

export type WorkProfileUpdateDependencies = {
  loadSession: () => Promise<WorkProfileSession | null>;
  updateProfile: (input: WorkProfileInput, requestId: string) => Promise<WorkProfileCommandResult>;
  createRequestId?: () => string;
};

function safeErrorLabel(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  return [code, name, message].filter(Boolean).join(" | ").slice(0, 240)
    || "unknown";
}

function safeInputShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "not_object";
  const body = value as Record<string, unknown>;
  return JSON.stringify({
    summary: typeof body.summary,
    preferredTaskTypes: Array.isArray(body.preferredTaskTypes) ? body.preferredTaskTypes.length : typeof body.preferredTaskTypes,
    growthGoals: Array.isArray(body.growthGoals) ? body.growthGoals.length : typeof body.growthGoals,
    weeklyCapacityHours: typeof body.weeklyCapacityHours,
    selfSkills: Array.isArray(body.selfSkills) ? body.selfSkills.length : typeof body.selfSkills,
  });
}

function commandFailure(error: unknown) {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "42501") return { error: "forbidden", status: 403 };
  if (typeof code === "string" && code.startsWith("22")) return { error: "invalid_request", status: 400 };
  return { error: "profile_save_failed", status: 409 };
}

export const defaultWorkProfileUpdateDependencies: WorkProfileUpdateDependencies = {
  loadSession: getWorkspaceSession,
  async updateProfile(input, requestId) {
    const client = await getSupabaseServerClient();
    const result = await client.rpc("update_current_employee_work_profile", {
      p_summary: input.summary,
      p_preferred_task_types: input.preferredTaskTypes,
      p_growth_goals: input.growthGoals,
      p_weekly_capacity_hours: input.weeklyCapacityHours,
      p_self_skills: input.selfSkills,
      request_id: requestId,
    });
    if (result.error || !result.data || typeof result.data !== "object") {
      throw result.error ?? new Error("profile_save_failed");
    }
    const value = result.data as Record<string, unknown>;
    if (value.outcome === "success" && value.profile && typeof value.profile === "object") {
      return { outcome: "success", profile: value.profile };
    }
    if (value.outcome === "failure" && (value.error === "profile_not_found" || value.error === "conflict")) {
      return { outcome: "failure", error: value.error };
    }
    throw new Error("profile_save_failed");
  },
};

export function createWorkProfileUpdateHandler(dependencies: WorkProfileUpdateDependencies) {
  return async function updateWorkProfile(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (session.member.status !== "active") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const input = parseWorkProfileInput(body);
    if (!input) {
      console.warn("[work-profile] invalid input", safeInputShape(body));
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    try {
      const result = await dependencies.updateProfile(input, dependencies.createRequestId?.() ?? randomUUID());
      if (result.outcome === "failure") {
        return NextResponse.json({ error: result.error }, { status: result.error === "profile_not_found" ? 404 : 409 });
      }
      return NextResponse.json({ profile: result.profile }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      console.error("[work-profile] save failed", safeErrorLabel(error));
      const failure = commandFailure(error);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }
  };
}
