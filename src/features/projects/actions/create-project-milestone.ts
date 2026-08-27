"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import type { Milestone } from "@/features/projects/types";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type CreateMilestoneInput = {
  projectPublicId: string;
  ownerPublicId: string;
  idempotencyKey: string;
  name: string;
  startDate?: string;
  dueDate: string;
  progress: number;
};

export type CreateMilestoneResult =
  | { ok: true; milestone: Milestone }
  | {
    ok: false;
    reason: "invalid" | "unavailable" | "forbidden" | "not_found" | "conflict" | "command_failed" | "ambiguous";
    message: string;
  };

function canonicalUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function canonicalDate(value: unknown, required = true) {
  if (!required && (value === undefined || value === "")) return undefined;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function rejected(reason: Exclude<CreateMilestoneResult, { ok: true }>["reason"]): CreateMilestoneResult {
  const messages = {
    invalid: "请检查阶段名称、日期、负责人和完成百分比。",
    unavailable: "当前未配置云端服务，里程碑将保存到浏览器本地项目仓库。",
    forbidden: "当前账号没有管理该项目里程碑的权限。",
    not_found: "项目或负责人已变更，请刷新后重试。",
    conflict: "本次创建请求与已提交记录冲突，请刷新后重试。",
    command_failed: "里程碑保存失败，系统已记录本次失败，请重新提交。",
    ambiguous: "未能确认本次保存结果，请保持页面打开并使用原请求重试。",
  } as const;
  return { ok: false, reason, message: messages[reason] };
}

export async function createProjectMilestone(
  input: CreateMilestoneInput,
): Promise<CreateMilestoneResult> {
  if (!input || typeof input !== "object") return rejected("invalid");

  const projectPublicId = canonicalUuid(input.projectPublicId);
  const ownerPublicId = canonicalUuid(input.ownerPublicId);
  const idempotencyKey = canonicalUuid(input.idempotencyKey);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const startDate = canonicalDate(input.startDate, false);
  const dueDate = canonicalDate(input.dueDate);
  const progress = input.progress;

  if (!projectPublicId || !ownerPublicId || !idempotencyKey
    || name.length < 1 || name.length > 160
    || startDate === null || !dueDate || (startDate && startDate > dueDate)
    || typeof progress !== "number" || !Number.isFinite(progress)
    || progress < 0 || progress > 100) {
    return rejected("invalid");
  }

  if (!hasSupabaseEnv()) return rejected("unavailable");

  try {
    const client = await getSupabaseServerClient();
    const response = await client.rpc("create_current_project_milestone", {
      p_project_public_id: projectPublicId,
      p_name: name,
      p_description: "",
      p_owner_employee_public_id: ownerPublicId,
      p_start_date: startDate ?? null,
      p_due_date: dueDate,
      p_progress: progress,
      p_reason: "在项目详情新增里程碑",
      request_id: randomUUID(),
      idempotency_key: idempotencyKey,
    });
    if (response.error) {
      if (response.error.code === "42501") return rejected("forbidden");
      if (response.error.code === "23514" || response.error.code?.startsWith("22")) return rejected("invalid");
      return rejected("ambiguous");
    }
    if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
      return rejected("ambiguous");
    }

    const command = response.data as Record<string, unknown>;
    if (command.outcome === "failure" && typeof command.error === "string") {
      if (command.error === "forbidden" || command.error === "not_found") return rejected(command.error);
      if (command.error === "conflict" || command.error === "scope_conflict") return rejected("conflict");
      if (command.error === "invalid_request") return rejected("invalid");
      if (command.error === "command_failed") return rejected("command_failed");
      return rejected("ambiguous");
    }

    const commandId = canonicalUuid(command.id);
    const commandVersion = positiveInteger(command.version);
    if (command.outcome !== "success" || command.resource !== "milestone"
      || !commandId || !commandVersion
      || !command.entity || typeof command.entity !== "object" || Array.isArray(command.entity)) {
      return rejected("ambiguous");
    }

    const row = command.entity as Record<string, unknown>;
    const rowId = canonicalUuid(row.id);
    const rowProjectId = canonicalUuid(row.projectId);
    const rowOwnerPublicId = canonicalUuid(row.ownerPublicId);
    const rowVersion = positiveInteger(row.version);
    const rowStartDate = row.startDate === null ? undefined : canonicalDate(row.startDate, false);
    const rowDueDate = canonicalDate(row.dueDate);
    const createdAt = timestamp(row.createdAt);
    const updatedAt = timestamp(row.updatedAt);
    if (!rowId || rowId !== commandId || !rowVersion || rowVersion !== commandVersion
      || typeof row.organizationId !== "string" || !/^[1-9]\d*$/.test(row.organizationId)
      || rowProjectId !== projectPublicId || rowOwnerPublicId !== ownerPublicId
      || row.name !== name || typeof row.description !== "string"
      || typeof row.status !== "string"
      || !["pending", "in_progress", "completed", "overdue"].includes(row.status)
      || rowStartDate === null || rowStartDate !== startDate || rowDueDate !== dueDate
      || typeof row.progress !== "number" || !Number.isFinite(row.progress)
      || row.progress < 0 || row.progress > 100
      || typeof row.sortOrder !== "number" || !Number.isSafeInteger(row.sortOrder) || row.sortOrder < 0
      || !createdAt || !updatedAt) {
      return rejected("ambiguous");
    }

    const milestone: Milestone = {
      id: rowId,
      organizationId: row.organizationId,
      projectId: rowProjectId,
      ownerId: rowOwnerPublicId,
      name,
      description: row.description,
      status: row.status as Milestone["status"],
      startDate: rowStartDate,
      dueDate: rowDueDate,
      progress: row.progress,
      sortOrder: row.sortOrder,
      createdAt,
      updatedAt,
    };

    revalidatePath(`/projects/${projectPublicId}`);
    return { ok: true, milestone };
  } catch {
    return rejected("ambiguous");
  }
}
