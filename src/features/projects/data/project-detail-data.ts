import { getProjectDetailMock } from "@/features/projects/mock-data";
import {
  fallbackProjectMember,
  loadAvailableProjectMembers,
  loadProjectMemberDirectory,
} from "@/features/projects/data/project-member-data";
import type {
  Milestone,
  Objective,
  Project,
  ProjectActivity,
  ProjectDetailData,
  ProjectDetailResult,
  FileRelation,
  ProjectMember,
  ProjectFile,
  ProjectRisk,
  ProjectTask,
  TaskComment,
  DailyReport,
  TaskAcceptanceEvent,
} from "@/features/projects/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { shouldAllowMockBusinessData } from "@/lib/runtime/workstation-mode";
import { loadActiveWorkspaceScope } from "@/features/projects/data/active-workspace-data";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type ProjectDetailClientFactory = () => Promise<SupabaseServerClient>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const acceptanceEventTypes = new Set(["submitted", "review_passed", "review_rejected", "reopened"]);

type ProjectRow = {
  id: number;
  public_id: string;
  organization_id: number;
  objective_id: number | null;
  code: string;
  name: string;
  description: string;
  category: string;
  budget_amount: number | string;
  owner_member_id: number;
  created_by_member_id: number;
  status: Project["status"];
  health: Project["health"];
  priority: Project["priority"];
  start_date: string;
  due_date: string;
  actual_end_date: string | null;
  progress: number | string;
  version: number;
  created_at: string;
  updated_at: string;
};

type ProjectMemberRow = {
  id: number;
  public_id: string;
  organization_id: number;
  project_id: number;
  member_id: number;
  role: ProjectMember["role"];
  allocation_percent: number | string;
  joined_at: string;
  left_at: string | null;
  version: number;
};

type ObjectiveRow = {
  public_id: string;
  organization_id: number;
  parent_objective_id: number | null;
  owner_member_id: number;
  created_by_member_id: number;
  title: string;
  description: string;
  scope: Objective["scope"];
  status: Objective["status"];
  period_start: string;
  period_end: string;
  progress: number | string;
  created_at: string;
  updated_at: string;
};

type MilestoneRow = {
  id: number;
  public_id: string;
  organization_id: number;
  owner_member_id: number | null;
  name: string;
  description: string;
  status: Milestone["status"];
  start_date: string | null;
  due_date: string;
  completed_at: string | null;
  progress: number | string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: number;
  public_id: string;
  organization_id: number;
  milestone_id: number | null;
  parent_task_id: number | null;
  title: string;
  description: string;
  acceptance_criteria: string;
  assignee_member_id: number | null;
  reporter_member_id: number;
  status: ProjectTask["status"];
  priority: ProjectTask["priority"];
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  progress: number | string;
  estimated_hours: number | string | null;
  sort_order: number;
  version: number;
  result_summary: string;
  result_link: string;
  result_files: string[];
  review_note: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

type ActivityRow = {
  public_id: string;
  organization_id: number;
  actor_member_id: number | null;
  user_id: string;
  action_type: ProjectActivity["actionType"];
  content: string;
  created_at: string;
};

type RiskRow = {
  public_id: string;
  organization_id: number;
  title: string;
  level: ProjectRisk["level"];
  owner_member_id: number;
  status: ProjectRisk["status"];
  deadline: string;
  created_at: string;
  updated_at: string;
};

type ObjectivePublicRow = { public_id: string };

type FileRow = {
  id: number;
  public_id: string;
  organization_id: number;
  project_id: number;
  task_id: number | null;
  bucket: string;
  object_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number | string;
  sha256: string | null;
  access_scope: ProjectFile["accessScope"];
  uploaded_by_member_id: number;
  verified_at: string | null;
  created_at: string;
};

type FileRelationRow = {
  public_id: string;
  organization_id: number;
  project_id: number;
  file_id: number;
  relation_type: FileRelation["relationType"];
  task_id: number | null;
  milestone_id: number | null;
  daily_report_id: number | null;
  task_comment_id: number | null;
  created_by_member_id: number;
  created_at: string;
};

type TaskCommentRow = {
  id: number;
  public_id: string;
  organization_id: number;
  task_id: number;
  author_member_id: number;
  body: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type DailyReportRow = {
  id: number;
  public_id: string;
  organization_id: number;
  author_member_id: number;
  report_date: string;
  status: DailyReport["status"];
  summary: string;
  next_plan: string;
  blockers: string | null;
  support_needed: string | null;
  submitted_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

function asNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function requiredMemberPublicId(
  directory: Awaited<ReturnType<typeof loadProjectMemberDirectory>>,
  memberId: number,
) {
  const publicId = directory.get(memberId)?.summary.id;
  if (!publicId) throw new Error("member_directory_incomplete");
  return publicId;
}

function canonicalUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function canonicalTime(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function optionalBoundedText(value: unknown, maximum: number) {
  if (value === null) return undefined;
  return typeof value === "string" && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
    ? value : null;
}

export function mapCanonicalAcceptanceEvent(raw: unknown): TaskAcceptanceEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("acceptance_history_invalid");
  const row = raw as Record<string, unknown>;
  const id = canonicalUuid(row.event_public_id);
  const taskId = canonicalUuid(row.task_public_id);
  const actorEmployeePublicId = canonicalUuid(row.actor_employee_public_id);
  const eventType = typeof row.event_type === "string" && acceptanceEventTypes.has(row.event_type)
    ? row.event_type as TaskAcceptanceEvent["eventType"] : null;
  const actorName = typeof row.actor_name === "string" && row.actor_name.trim()
    && row.actor_name.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(row.actor_name) ? row.actor_name : null;
  const taskVersion = typeof row.task_version === "number" && Number.isSafeInteger(row.task_version)
    && row.task_version > 0 ? row.task_version : null;
  const resultText = optionalBoundedText(row.result_text, 4000);
  const note = optionalBoundedText(row.note, 2000);
  const resultLinkText = optionalBoundedText(row.result_link, 2000);
  let resultLink: string | undefined | null = resultLinkText;
  if (typeof resultLinkText === "string") {
    try {
      const parsed = new URL(resultLinkText);
      resultLink = parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
    } catch { resultLink = null; }
  }
  const resultFiles = Array.isArray(row.result_files) && row.result_files.length <= 10
    ? row.result_files.map(canonicalUuid) : null;
  const decision = row.decision === null ? undefined
    : row.decision === "pass" || row.decision === "reject" ? row.decision : null;
  const occurredAt = canonicalTime(row.occurred_at);
  if (!id || !taskId || !actorEmployeePublicId || !eventType || !actorName || !taskVersion
    || resultText === null || note === null || resultLink === null || !resultFiles
    || resultFiles.some((fileId) => !fileId) || decision === null || !occurredAt) {
    throw new Error("acceptance_history_invalid");
  }
  return {
    id, taskId, eventType, actorEmployeePublicId, actorName, taskVersion,
    resultText, resultLink, resultFiles: resultFiles as string[], decision, note, occurredAt,
  };
}

function mapObjective(
  row: ObjectiveRow,
  directory: Awaited<ReturnType<typeof loadProjectMemberDirectory>>,
  organizationPublicId: string,
  parentObjectivePublicId?: string,
): Objective {
  return {
    id: row.public_id,
    organizationId: organizationPublicId,
    parentObjectiveId: parentObjectivePublicId,
    ownerId: requiredMemberPublicId(directory, row.owner_member_id),
    createdById: requiredMemberPublicId(directory, row.created_by_member_id),
    title: row.title,
    description: row.description,
    scope: row.scope,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    progress: asNumber(row.progress),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProject(
  row: ProjectRow,
  organizationPublicId: string,
  ownerId: string,
  createdById: string,
  objectivePublicId?: string,
): Project {
  return {
    id: row.public_id,
    organizationId: organizationPublicId,
    objectiveId: objectivePublicId,
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    budgetAmount: asNumber(row.budget_amount).toFixed(2),
    ownerId,
    createdById,
    status: row.status,
    health: row.health,
    priority: row.priority,
    startDate: row.start_date,
    dueDate: row.due_date,
    actualEndDate: row.actual_end_date ?? undefined,
    progress: asNumber(row.progress),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function matchingMock(projectPublicId: string) {
  const detail = getProjectDetailMock(projectPublicId);
  return detail ? { detail, source: "mock" as const } : undefined;
}

export async function loadProjectDetail(
  projectPublicId: string,
  clientFactory: ProjectDetailClientFactory = getSupabaseServerClient,
  options: { allowMockFallback?: boolean } = {},
): Promise<ProjectDetailResult | undefined> {
  const runtimeAllowsMock = shouldAllowMockBusinessData();
  const allowMockFallback = (options.allowMockFallback ?? runtimeAllowsMock) && runtimeAllowsMock;
  const fallback = () => allowMockFallback ? matchingMock(projectPublicId) : undefined;

  try {
    const client = await clientFactory();
    const scope = await loadActiveWorkspaceScope(client);
    const projectResponse = await client
      .from("projects")
      .select("id, public_id, organization_id, objective_id, code, name, description, category, budget_amount, owner_member_id, created_by_member_id, status, health, priority, start_date, due_date, actual_end_date, progress, version, created_at, updated_at")
      .eq("public_id", projectPublicId)
      .eq("tenant_id", scope.tenantId)
      .eq("organization_id", scope.organizationId)
      .is("deleted_at", null)
      .maybeSingle();

    if (projectResponse.error) {
      throw projectResponse.error;
    }

    if (!projectResponse.data) {
      return fallback();
    }

    const projectRow = projectResponse.data as ProjectRow;
    const objectivePromise = projectRow.objective_id == null
      ? Promise.resolve({ data: null, error: null })
      : client
        .from("objectives")
        .select("public_id, organization_id, parent_objective_id, owner_member_id, created_by_member_id, title, description, scope, status, period_start, period_end, progress, created_at, updated_at")
        .eq("id", projectRow.objective_id)
        .is("deleted_at", null)
        .maybeSingle();
    const [objectiveResponse, memberResponse, milestoneResponse, taskResponse, commentResponse, reportResponse, activityResponse, riskResponse, fileResponse, fileRelationResponse, accessResponse, acceptanceResponse, availableMembers] = await Promise.all([
      objectivePromise,
      client
        .from("project_members")
        .select("id, public_id, organization_id, project_id, member_id, role, allocation_percent, joined_at, left_at, version")
        .eq("project_id", projectRow.id)
        .is("left_at", null)
        .order("joined_at"),
      client
        .from("milestones")
        .select("id, public_id, organization_id, owner_member_id, name, description, status, start_date, due_date, completed_at, progress, sort_order, created_at, updated_at")
        .eq("project_id", projectRow.id)
        .is("deleted_at", null)
        .order("sort_order"),
      client
        .from("tasks")
        .select("id, public_id, organization_id, milestone_id, parent_task_id, title, description, acceptance_criteria, assignee_member_id, reporter_member_id, status, priority, start_date, due_date, completed_at, progress, estimated_hours, sort_order, version, result_summary, result_link, result_files, review_note, submitted_at, reviewed_at, accepted_at, created_at, updated_at")
        .eq("project_id", projectRow.id)
        .is("deleted_at", null)
        .order("sort_order"),
      client
        .from("task_comments")
        .select("id, public_id, organization_id, task_id, author_member_id, body, version, created_at, updated_at")
        .eq("project_id", projectRow.id)
        .is("deleted_at", null)
        .order("created_at"),
      client
        .from("daily_reports")
        .select("id, public_id, organization_id, author_member_id, report_date, status, summary, next_plan, blockers, support_needed, submitted_at, version, created_at, updated_at")
        .eq("project_id", projectRow.id)
        .is("deleted_at", null)
        .order("report_date", { ascending: false }),
      client
        .from("project_activities")
        .select("public_id, organization_id, actor_member_id, user_id, action_type, content, created_at")
        .eq("project_id", projectRow.id)
        .order("created_at", { ascending: false })
        .limit(12),
      client
        .from("project_risks")
        .select("public_id, organization_id, title, level, owner_member_id, status, deadline, created_at, updated_at")
        .eq("project_id", projectRow.id)
        .is("deleted_at", null)
        .order("deadline"),
      client
        .from("files")
        .select("id, public_id, organization_id, project_id, task_id, bucket, object_path, original_name, mime_type, size_bytes, sha256, access_scope, uploaded_by_member_id, verified_at, created_at")
        .eq("project_id", projectRow.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      client
        .from("file_relations")
        .select("public_id, organization_id, project_id, file_id, relation_type, task_id, milestone_id, daily_report_id, task_comment_id, created_by_member_id, created_at")
        .eq("project_id", projectRow.id)
        .order("created_at", { ascending: false }),
      typeof client.rpc === "function"
        ? client.rpc("can_manage_project", { target_project_id: projectRow.id })
        : Promise.resolve({ data: false, error: null }),
      typeof client.rpc === "function"
        ? client.rpc("current_task_acceptance_history", { p_project_public_id: projectPublicId })
        : Promise.resolve({ data: [], error: null }),
      loadAvailableProjectMembers(client, scope),
    ]);

    const responses = [objectiveResponse, memberResponse, milestoneResponse, taskResponse, commentResponse, reportResponse, activityResponse, riskResponse, fileResponse, fileRelationResponse, accessResponse, acceptanceResponse];
    const relatedError = responses.find(({ error }) => error)?.error;
    if (relatedError) {
      throw relatedError;
    }

    const objectiveRow = objectiveResponse.data as ObjectiveRow | null;
    const parentObjectiveResponse = objectiveRow?.parent_objective_id == null
      ? { data: null, error: null }
      : await client
        .from("objectives")
        .select("public_id")
        .eq("id", objectiveRow.parent_objective_id)
        .is("deleted_at", null)
        .maybeSingle();
    if (parentObjectiveResponse.error) throw parentObjectiveResponse.error;

    const memberRows = (memberResponse.data ?? []) as ProjectMemberRow[];
    const milestoneRows = (milestoneResponse.data ?? []) as MilestoneRow[];
    const taskRows = (taskResponse.data ?? []) as TaskRow[];
    const commentRows = (commentResponse.data ?? []) as TaskCommentRow[];
    const reportRows = (reportResponse.data ?? []) as DailyReportRow[];
    const riskRows = (riskResponse.data ?? []) as RiskRow[];
    const activityRows = (activityResponse.data ?? []) as ActivityRow[];
    const fileRows = (fileResponse.data ?? []) as FileRow[];
    const fileRelationRows = (fileRelationResponse.data ?? []) as FileRelationRow[];
    const memberDirectory = await loadProjectMemberDirectory(
      client,
      [
        projectRow.owner_member_id,
        projectRow.created_by_member_id,
        ...(objectiveRow ? [objectiveRow.owner_member_id, objectiveRow.created_by_member_id] : []),
        ...memberRows.map(({ member_id }) => member_id),
        ...milestoneRows.flatMap(({ owner_member_id }) => owner_member_id == null ? [] : [owner_member_id]),
        ...taskRows.flatMap(({ assignee_member_id }) => assignee_member_id == null ? [] : [assignee_member_id]),
        ...taskRows.map(({ reporter_member_id }) => reporter_member_id),
        ...commentRows.map(({ author_member_id }) => author_member_id),
        ...reportRows.map(({ author_member_id }) => author_member_id),
        ...riskRows.map(({ owner_member_id }) => owner_member_id),
        ...activityRows.flatMap(({ actor_member_id }) => actor_member_id == null ? [] : [actor_member_id]),
        ...fileRows.map(({ uploaded_by_member_id }) => uploaded_by_member_id),
        ...fileRelationRows.map(({ created_by_member_id }) => created_by_member_id),
      ],
      scope,
    );
    const members: ProjectMember[] = memberRows.map((row) => {
      const member = memberDirectory.get(row.member_id)?.summary
        ?? fallbackProjectMember(row.member_id, row.role);

      return {
        id: row.public_id,
        organizationId: scope.organizationPublicId,
        projectId: projectPublicId,
        member,
        role: row.role,
        allocationPercent: asNumber(row.allocation_percent),
        joinedAt: row.joined_at,
      leftAt: row.left_at ?? undefined,
      version: row.version,
      };
    });

    const membershipsByMemberId = new Map(
      memberRows.map((row, index) => [row.member_id, members[index]]),
    );
    const ownerMembership = membershipsByMemberId.get(projectRow.owner_member_id)
      ?? members.find((membership) => membership.role === "owner");
    const owner = memberDirectory.get(projectRow.owner_member_id)?.summary
      ?? ownerMembership?.member
      ?? fallbackProjectMember(projectRow.owner_member_id, "owner");

    const milestonePublicIds = new Map(milestoneRows.map((row) => [row.id, row.public_id]));
    const milestones = milestoneRows.map<Milestone>((row) => ({
      id: row.public_id,
      organizationId: scope.organizationPublicId,
      projectId: projectPublicId,
      ownerId: row.owner_member_id == null
        ? undefined
        : memberDirectory.get(row.owner_member_id)?.summary.id
          ?? String(row.owner_member_id),
      name: row.name,
      description: row.description,
      status: row.status,
      startDate: row.start_date ?? undefined,
      dueDate: row.due_date,
      completedAt: row.completed_at ?? undefined,
      progress: asNumber(row.progress),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const taskPublicIds = new Map(taskRows.map((row) => [row.id, row.public_id]));
    const tasks = taskRows.map<ProjectTask>((row) => ({
      id: row.public_id,
      organizationId: scope.organizationPublicId,
      projectId: projectPublicId,
      milestoneId: row.milestone_id == null
        ? undefined
        : milestonePublicIds.get(row.milestone_id),
      parentTaskId: row.parent_task_id == null
        ? undefined
        : taskPublicIds.get(row.parent_task_id),
      title: row.title,
      description: row.description,
      acceptanceCriteria: row.acceptance_criteria,
      assigneeId: row.assignee_member_id == null
        ? undefined
        : memberDirectory.get(row.assignee_member_id)?.summary.id
          ?? String(row.assignee_member_id),
      reporterId: memberDirectory.get(row.reporter_member_id)?.summary.id
        ?? String(row.reporter_member_id),
      status: row.status,
      priority: row.priority,
      startDate: row.start_date ?? undefined,
      dueDate: row.due_date ?? undefined,
      completedAt: row.completed_at ?? undefined,
      progress: asNumber(row.progress),
      estimatedHours: row.estimated_hours == null ? undefined : asNumber(row.estimated_hours),
      sortOrder: row.sort_order,
      version: row.version,
      resultText: row.result_summary || undefined,
      resultLink: row.result_link || undefined,
      resultFiles: row.result_files ?? [],
      reviewNote: row.review_note || undefined,
      submittedAt: row.submitted_at ?? undefined,
      reviewedAt: row.reviewed_at ?? undefined,
      acceptedAt: row.accepted_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const commentPublicIds = new Map(commentRows.map((row) => [row.id, row.public_id]));
    const comments = commentRows.flatMap<TaskComment>((row) => {
      const taskId = taskPublicIds.get(row.task_id);
      if (!taskId) return [];
      return [{
        id: row.public_id,
        organizationId: scope.organizationPublicId,
        projectId: projectPublicId,
        taskId,
        authorId: memberDirectory.get(row.author_member_id)?.summary.id ?? String(row.author_member_id),
        body: row.body,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }];
    });

    const reportPublicIds = new Map(reportRows.map((row) => [row.id, row.public_id]));
    const dailyReports = reportRows.map<DailyReport>((row) => ({
      id: row.public_id,
      organizationId: scope.organizationPublicId,
      projectId: projectPublicId,
      authorId: memberDirectory.get(row.author_member_id)?.summary.id ?? String(row.author_member_id),
      reportDate: row.report_date,
      status: row.status,
      summary: row.summary,
      nextPlan: row.next_plan,
      blockers: row.blockers ?? undefined,
      supportNeeded: row.support_needed ?? undefined,
      submittedAt: row.submitted_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    }));

    const activities = activityRows.map<ProjectActivity>((row) => ({
      id: row.public_id,
      organizationId: scope.organizationPublicId,
      projectId: projectPublicId,
      userId: row.actor_member_id == null
        ? row.user_id
        : memberDirectory.get(row.actor_member_id)?.summary.id ?? row.user_id,
      actionType: row.action_type,
      content: row.content,
      createdAt: row.created_at,
    }));

    const risks = riskRows.map<ProjectRisk>((row) => ({
      id: row.public_id,
        organizationId: scope.organizationPublicId,
      projectId: projectPublicId,
      title: row.title,
      level: row.level,
      ownerId: requiredMemberPublicId(memberDirectory, row.owner_member_id),
      status: row.status,
      deadline: row.deadline,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const acceptanceEvents = ((acceptanceResponse.data ?? []) as unknown[]).map(mapCanonicalAcceptanceEvent);

    const filePublicIds = new Map(fileRows.map((row) => [row.id, row.public_id]));
    const files = fileRows.map<ProjectFile>((row) => ({
      id: row.public_id,
      organizationId: scope.organizationPublicId,
      projectId: projectPublicId,
      taskId: row.task_id == null ? undefined : taskPublicIds.get(row.task_id),
      bucket: row.bucket,
      objectPath: row.object_path,
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: asNumber(row.size_bytes),
      sha256: row.sha256 ?? undefined,
      accessScope: row.access_scope,
      uploadedById: memberDirectory.get(row.uploaded_by_member_id)?.summary.id
        ?? String(row.uploaded_by_member_id),
      verifiedAt: row.verified_at ?? undefined,
      createdAt: row.created_at,
    }));
    const fileRelations = fileRelationRows.flatMap<FileRelation>((row) => {
      const fileId = filePublicIds.get(row.file_id);
      if (!fileId) return [];
      return [{
        id: row.public_id,
        organizationId: scope.organizationPublicId,
        projectId: projectPublicId,
        fileId,
        relationType: row.relation_type,
        taskId: row.task_id == null ? undefined : taskPublicIds.get(row.task_id),
        milestoneId: row.milestone_id == null ? undefined : milestonePublicIds.get(row.milestone_id),
        dailyReportId: row.daily_report_id == null ? undefined : reportPublicIds.get(row.daily_report_id),
        taskCommentId: row.task_comment_id == null ? undefined : commentPublicIds.get(row.task_comment_id),
        createdById: memberDirectory.get(row.created_by_member_id)?.summary.id
          ?? String(row.created_by_member_id),
        createdAt: row.created_at,
      }];
    });

    const detail: ProjectDetailData = {
      project: mapProject(
        projectRow,
        scope.organizationPublicId,
        owner.id,
        requiredMemberPublicId(memberDirectory, projectRow.created_by_member_id),
        objectiveRow?.public_id,
      ),
      objective: objectiveRow
        ? mapObjective(
          objectiveRow,
          memberDirectory,
          scope.organizationPublicId,
          (parentObjectiveResponse.data as ObjectivePublicRow | null)?.public_id,
        )
        : undefined,
      owner,
      members,
      milestones,
      tasks,
      comments,
      files,
      dailyReports,
      activities,
      risks,
      fileRelations,
      acceptanceEvents,
    };

    return {
      detail,
      source: "supabase",
      access: {
        canManage: accessResponse.data === true,
        viewerMemberId: scope.memberPublicId,
      },
      availableMembers,
    };
  } catch (error) {
    const fallbackResult = fallback();
    if (fallbackResult) return fallbackResult;
    if (!allowMockFallback) throw error;
    return undefined;
  }
}
