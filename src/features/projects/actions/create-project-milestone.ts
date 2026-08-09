"use server";

import { revalidatePath } from "next/cache";

import type { Milestone } from "@/features/projects/types";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type CreateMilestoneInput = {
  projectPublicId: string;
  ownerMembershipId: string;
  name: string;
  startDate?: string;
  dueDate: string;
  progress: number;
};

export type CreateMilestoneResult =
  | { ok: true; milestone: Milestone }
  | { ok: false; reason: "invalid" | "unavailable" | "failed"; message: string };

export async function createProjectMilestone(
  input: CreateMilestoneInput,
): Promise<CreateMilestoneResult> {
  const name = input.name.trim();
  const progress = Number(input.progress);

  if (
    !name
    || !input.dueDate
    || !Number.isFinite(progress)
    || progress < 0
    || progress > 100
    || (input.startDate && input.startDate > input.dueDate)
  ) {
    return {
      ok: false,
      reason: "invalid",
      message: "请检查阶段名称、日期和完成百分比。",
    };
  }

  if (!hasSupabaseEnv()) {
    return {
      ok: false,
      reason: "unavailable",
      message: "当前未配置云端服务，里程碑将保存到浏览器本地项目仓库。",
    };
  }

  try {
    const client = await getSupabaseServerClient();
    const projectResponse = await client
      .from("projects")
      .select("id, organization_id")
      .eq("public_id", input.projectPublicId)
      .is("deleted_at", null)
      .single();

    if (projectResponse.error || !projectResponse.data) {
      throw projectResponse.error ?? new Error("Project is unavailable.");
    }

    const membershipResponse = await client
      .from("project_members")
      .select("member_id")
      .eq("public_id", input.ownerMembershipId)
      .eq("project_id", projectResponse.data.id)
      .is("left_at", null)
      .single();

    if (membershipResponse.error || !membershipResponse.data) {
      throw membershipResponse.error ?? new Error("Project member is unavailable.");
    }

    const latestMilestoneResponse = await client
      .from("milestones")
      .select("sort_order")
      .eq("project_id", projectResponse.data.id)
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestMilestoneResponse.error) {
      throw latestMilestoneResponse.error;
    }

    const status = progress >= 100 ? "completed" : progress > 0 ? "in_progress" : "pending";
    const insertResponse = await client
      .from("milestones")
      .insert({
        organization_id: projectResponse.data.organization_id,
        project_id: projectResponse.data.id,
        owner_member_id: membershipResponse.data.member_id,
        name,
        description: "",
        status,
        start_date: input.startDate || null,
        due_date: input.dueDate,
        progress,
        sort_order: (latestMilestoneResponse.data?.sort_order ?? -1) + 1,
      })
      .select("public_id, organization_id, name, description, status, start_date, due_date, completed_at, progress, sort_order, created_at, updated_at")
      .single();

    if (insertResponse.error || !insertResponse.data) {
      throw insertResponse.error ?? new Error("Milestone was not created.");
    }

    const row = insertResponse.data;
    const milestone: Milestone = {
      id: row.public_id,
      organizationId: String(row.organization_id),
      projectId: input.projectPublicId,
      ownerId: input.ownerMembershipId,
      name: row.name,
      description: row.description,
      status: row.status,
      startDate: row.start_date ?? undefined,
      dueDate: row.due_date,
      completedAt: row.completed_at ?? undefined,
      progress: Number(row.progress),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    revalidatePath(`/projects/${input.projectPublicId}`);
    return { ok: true, milestone };
  } catch {
    return {
      ok: false,
      reason: "failed",
      message: "里程碑保存失败，请确认项目管理权限或稍后重试。",
    };
  }
}
