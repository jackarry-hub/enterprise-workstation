import { NextResponse } from "next/server";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import {
  parseWorkProfileInput,
  type WorkProfileInput,
} from "@/features/work-profile/work-profile-schema";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

type WorkProfileSession = { member: { id: number } };

export type WorkProfileUpdateDependencies = {
  loadSession: () => Promise<WorkProfileSession | null>;
  saveProfile: (memberId: number, input: WorkProfileInput) => Promise<unknown>;
};

export const defaultWorkProfileUpdateDependencies: WorkProfileUpdateDependencies = {
  loadSession: getWorkspaceSession,
  async saveProfile(memberId, input) {
    const client = getSupabaseServiceRoleClient();
    const profileResult = await client.from("employee_profiles")
      .select("id, tenant_id, organization_id")
      .eq("organization_member_id", memberId)
      .is("deleted_at", null)
      .single();
    if (profileResult.error || !profileResult.data) {
      throw profileResult.error ?? new Error("employee_profile_not_found");
    }
    const result = await client.from("employee_work_profiles")
      .upsert({
        tenant_id: profileResult.data.tenant_id,
        organization_id: profileResult.data.organization_id,
        employee_profile_id: profileResult.data.id,
        summary: input.summary,
        preferred_task_types: input.preferredTaskTypes,
        growth_goals: input.growthGoals,
        weekly_capacity_hours: input.weeklyCapacityHours,
        self_skills: input.selfSkills,
      }, { onConflict: "tenant_id,employee_profile_id" })
      .select("summary, preferred_task_types, growth_goals, weekly_capacity_hours, self_skills, updated_at")
      .single();
    if (result.error || !result.data) {
      throw result.error ?? new Error("profile_save_failed");
    }
    return {
      summary: result.data.summary,
      preferredTaskTypes: result.data.preferred_task_types ?? [],
      growthGoals: result.data.growth_goals ?? [],
      weeklyCapacityHours: Number(result.data.weekly_capacity_hours),
      selfSkills: result.data.self_skills ?? [],
      updatedAt: result.data.updated_at,
    };
  },
};

export function createWorkProfileUpdateHandler(
  dependencies: WorkProfileUpdateDependencies,
) {
  return async function updateWorkProfile(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const input = parseWorkProfileInput(body);
    if (!input) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    try {
      const profile = await dependencies.saveProfile(session.member.id, input);
      return NextResponse.json({ profile }, {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return NextResponse.json(
        { error: "profile_save_failed" },
        { status: 409 },
      );
    }
  };
}
