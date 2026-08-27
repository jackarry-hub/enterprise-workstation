import { getProjectDetailMock } from "@/features/projects/mock-data";
import {
  fallbackProjectMember,
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
} from "@/features/projects/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { shouldAllowMockBusinessData } from "@/lib/runtime/workstation-mode";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type ProjectDetailClientFactory = () => Promise<SupabaseServerClient>;

type ProjectRow = {
  id: number;
  public_id: string;
  organization_id: number;
  objective_id: number | null;
  code: string;
  name: string;
  description: string;
  owner_member_id: number;
  created_by_member_id: number;
  status: Project["status"];
  health: Project["health"];
  priority: Project["priority"];
  start_date: string;
  due_date: string;
  actual_end_date: string | null;
  progress: number | string;
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
  created_at: string;
  updated_at: string;
};

type ActivityRow = {
  public_id: string;
  organization_id: number;
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

function asNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function mapObjective(row: ObjectiveRow): Objective {
  return {
    id: row.public_id,
    organizationId: String(row.organization_id),
    parentObjectiveId: row.parent_objective_id == null
      ? undefined
      : String(row.parent_objective_id),
    ownerId: String(row.owner_member_id),
    createdById: String(row.created_by_member_id),
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
  ownerId: string,
  objectivePublicId?: string,
): Project {
  return {
    id: row.public_id,
    organizationId: String(row.organization_id),
    objectiveId: objectivePublicId,
    code: row.code,
    name: row.name,
    description: row.description,
    ownerId,
    createdById: String(row.created_by_member_id),
    status: row.status,
    health: row.health,
    priority: row.priority,
    startDate: row.start_date,
    dueDate: row.due_date,
    actualEndDate: row.actual_end_date ?? undefined,
    progress: asNumber(row.progress),
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
  const allowMockFallback = options.allowMockFallback ?? shouldAllowMockBusinessData();
  const fallback = () => allowMockFallback ? matchingMock(projectPublicId) : undefined;

  try {
    const client = await clientFactory();
    const projectResponse = await client
      .from("projects")
      .select("id, public_id, organization_id, objective_id, code, name, description, owner_member_id, created_by_member_id, status, health, priority, start_date, due_date, actual_end_date, progress, created_at, updated_at")
      .eq("public_id", projectPublicId)
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
    const [objectiveResponse, memberResponse, milestoneResponse, taskResponse, activityResponse, riskResponse, fileResponse, fileRelationResponse] = await Promise.all([
      objectivePromise,
      client
        .from("project_members")
        .select("id, public_id, organization_id, project_id, member_id, role, allocation_percent, joined_at, left_at")
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
        .select("id, public_id, organization_id, milestone_id, parent_task_id, title, description, assignee_member_id, reporter_member_id, status, priority, start_date, due_date, completed_at, progress, estimated_hours, sort_order, created_at, updated_at")
        .eq("project_id", projectRow.id)
        .is("deleted_at", null)
        .order("sort_order"),
      client
        .from("project_activities")
        .select("public_id, organization_id, user_id, action_type, content, created_at")
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
    ]);

    const responses = [objectiveResponse, memberResponse, milestoneResponse, taskResponse, activityResponse, riskResponse, fileResponse, fileRelationResponse];
    const relatedError = responses.find(({ error }) => error)?.error;
    if (relatedError) {
      throw relatedError;
    }

    const memberRows = (memberResponse.data ?? []) as ProjectMemberRow[];
    const fileRows = (fileResponse.data ?? []) as FileRow[];
    const fileRelationRows = (fileRelationResponse.data ?? []) as FileRelationRow[];
    const memberDirectory = await loadProjectMemberDirectory(
      client,
      [
        projectRow.owner_member_id,
        ...memberRows.map(({ member_id }) => member_id),
        ...fileRows.map(({ uploaded_by_member_id }) => uploaded_by_member_id),
        ...fileRelationRows.map(({ created_by_member_id }) => created_by_member_id),
      ],
    );
    const members: ProjectMember[] = memberRows.map((row) => {
      const member = memberDirectory.get(row.member_id)?.summary
        ?? fallbackProjectMember(row.member_id, row.role);

      return {
        id: row.public_id,
        organizationId: String(row.organization_id),
        projectId: projectPublicId,
        member,
        role: row.role,
        allocationPercent: asNumber(row.allocation_percent),
        joinedAt: row.joined_at,
        leftAt: row.left_at ?? undefined,
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

    const milestoneRows = (milestoneResponse.data ?? []) as MilestoneRow[];
    const milestonePublicIds = new Map(milestoneRows.map((row) => [row.id, row.public_id]));
    const milestones = milestoneRows.map<Milestone>((row) => ({
      id: row.public_id,
      organizationId: String(row.organization_id),
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

    const taskRows = (taskResponse.data ?? []) as TaskRow[];
    const taskPublicIds = new Map(taskRows.map((row) => [row.id, row.public_id]));
    const tasks = taskRows.map<ProjectTask>((row) => ({
      id: row.public_id,
      organizationId: String(row.organization_id),
      projectId: projectPublicId,
      milestoneId: row.milestone_id == null
        ? undefined
        : milestonePublicIds.get(row.milestone_id),
      parentTaskId: row.parent_task_id == null
        ? undefined
        : taskPublicIds.get(row.parent_task_id),
      title: row.title,
      description: row.description,
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const activities = ((activityResponse.data ?? []) as ActivityRow[]).map<ProjectActivity>((row) => ({
      id: row.public_id,
      organizationId: String(row.organization_id),
      projectId: projectPublicId,
      userId: row.user_id,
      actionType: row.action_type,
      content: row.content,
      createdAt: row.created_at,
    }));

    const risks = ((riskResponse.data ?? []) as RiskRow[]).map<ProjectRisk>((row) => ({
      id: row.public_id,
      organizationId: String(row.organization_id),
      projectId: projectPublicId,
      title: row.title,
      level: row.level,
      ownerId: String(row.owner_member_id),
      status: row.status,
      deadline: row.deadline,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const filePublicIds = new Map(fileRows.map((row) => [row.id, row.public_id]));
    const files = fileRows.map<ProjectFile>((row) => ({
      id: row.public_id,
      organizationId: String(row.organization_id),
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
        organizationId: String(row.organization_id),
        projectId: projectPublicId,
        fileId,
        relationType: row.relation_type,
        taskId: row.task_id == null ? undefined : taskPublicIds.get(row.task_id),
        milestoneId: row.milestone_id == null ? undefined : milestonePublicIds.get(row.milestone_id),
        dailyReportId: row.daily_report_id == null ? undefined : String(row.daily_report_id),
        taskCommentId: row.task_comment_id == null ? undefined : String(row.task_comment_id),
        createdById: memberDirectory.get(row.created_by_member_id)?.summary.id
          ?? String(row.created_by_member_id),
        createdAt: row.created_at,
      }];
    });

    const detail: ProjectDetailData = {
      project: mapProject(projectRow, owner.id),
      objective: objectiveResponse.data
        ? mapObjective(objectiveResponse.data as ObjectiveRow)
        : undefined,
      owner,
      members,
      milestones,
      tasks,
      comments: [],
      files,
      dailyReports: [],
      activities,
      risks,
      fileRelations,
    };

    return { detail, source: "supabase" };
  } catch (error) {
    const fallbackResult = fallback();
    if (fallbackResult) return fallbackResult;
    if (!allowMockFallback) throw error;
    return undefined;
  }
}
