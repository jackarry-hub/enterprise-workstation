import { getDefaultProjectDetails } from "@/features/projects/data/effective-project-details";
import {
  fallbackProjectMember,
  loadAvailableProjectMembers,
  loadProjectMemberDirectory,
} from "@/features/projects/data/project-member-data";
import { mockMembers } from "@/features/projects/mock-data";
import type {
  MemberSummary,
  Milestone,
  Objective,
  Project,
  ProjectActivity,
  ProjectDetailData,
  ProjectMember,
  ProjectTask,
} from "@/features/projects/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { shouldAllowMockBusinessData } from "@/lib/runtime/workstation-mode";
import { loadActiveWorkspaceScope } from "@/features/projects/data/active-workspace-data";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type ProjectCollectionClientFactory = () => Promise<SupabaseServerClient>;

export type ProjectCollectionResult = {
  details: readonly ProjectDetailData[];
  source: "supabase" | "mock";
  viewer: {
    memberId?: string;
    member?: MemberSummary;
  };
  availableMembers: readonly MemberSummary[];
};

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
};

type ObjectiveRow = {
  id: number;
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

type ObjectivePublicRow = { id: number; public_id: string };

type MilestoneRow = {
  id: number;
  public_id: string;
  organization_id: number;
  project_id: number;
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
  project_id: number;
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
  created_at: string;
  updated_at: string;
};

type ActivityRow = {
  public_id: string;
  organization_id: number;
  project_id: number;
  actor_member_id: number | null;
  user_id: string;
  action_type: ProjectActivity["actionType"];
  content: string;
  created_at: string;
};

function asNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mockResult(): ProjectCollectionResult {
  return { details: getDefaultProjectDetails(), source: "mock", viewer: {}, availableMembers: mockMembers };
}

function requiredMemberPublicId(
  directory: Awaited<ReturnType<typeof loadProjectMemberDirectory>>,
  memberId: number,
) {
  const publicId = directory.get(memberId)?.summary.id;
  if (!publicId) throw new Error("member_directory_incomplete");
  return publicId;
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

export async function loadProjectCollection(
  clientFactory: ProjectCollectionClientFactory = getSupabaseServerClient,
  options: { allowMockFallback?: boolean } = {},
): Promise<ProjectCollectionResult> {
  const runtimeAllowsMock = shouldAllowMockBusinessData();
  const allowMockFallback = (options.allowMockFallback ?? runtimeAllowsMock) && runtimeAllowsMock;

  try {
    const client = await clientFactory();
    const scope = await loadActiveWorkspaceScope(client);
    const projectResponse = await client
      .from("projects")
      .select("id, public_id, organization_id, objective_id, code, name, description, category, budget_amount, owner_member_id, created_by_member_id, status, health, priority, start_date, due_date, actual_end_date, progress, version, created_at, updated_at")
      .eq("tenant_id", scope.tenantId)
      .eq("organization_id", scope.organizationId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (projectResponse.error) throw projectResponse.error;

    const projectRows = (projectResponse.data ?? []) as ProjectRow[];
    const projectIds = projectRows.map(({ id }) => id);
    const objectiveIds = [...new Set(projectRows.flatMap(({ objective_id }) => objective_id == null ? [] : [objective_id]))];
    const availableMembersPromise = loadAvailableProjectMembers(client, scope);

    if (projectIds.length === 0) {
      const availableMembers = await availableMembersPromise;
      const viewerMember = availableMembers.find(({ id }) => id === scope.memberPublicId);
      return {
        details: [],
        source: "supabase",
        viewer: { memberId: scope.memberPublicId, member: viewerMember },
        availableMembers,
      };
    }

    const objectivePromise = objectiveIds.length > 0
      ? client
        .from("objectives")
        .select("id, public_id, organization_id, parent_objective_id, owner_member_id, created_by_member_id, title, description, scope, status, period_start, period_end, progress, created_at, updated_at")
        .in("id", objectiveIds)
        .is("deleted_at", null)
      : Promise.resolve({ data: [], error: null });
    const [membershipResponse, milestoneResponse, taskResponse, activityResponse, objectiveResponse, availableMembers] = await Promise.all([
      client
        .from("project_members")
        .select("id, public_id, organization_id, project_id, member_id, role, allocation_percent, joined_at, left_at")
        .in("project_id", projectIds)
        .is("left_at", null)
        .order("joined_at"),
      client
        .from("milestones")
        .select("id, public_id, organization_id, project_id, owner_member_id, name, description, status, start_date, due_date, completed_at, progress, sort_order, created_at, updated_at")
        .in("project_id", projectIds)
        .is("deleted_at", null)
        .order("sort_order"),
      client
        .from("tasks")
        .select("id, public_id, organization_id, project_id, milestone_id, parent_task_id, title, description, acceptance_criteria, assignee_member_id, reporter_member_id, status, priority, start_date, due_date, completed_at, progress, estimated_hours, sort_order, version, created_at, updated_at")
        .in("project_id", projectIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      client
        .from("project_activities")
        .select("public_id, organization_id, project_id, actor_member_id, user_id, action_type, content, created_at")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false })
        .limit(100),
      objectivePromise,
      availableMembersPromise,
    ]);
    const relatedError = [membershipResponse, milestoneResponse, taskResponse, activityResponse, objectiveResponse]
      .find(({ error }) => error)?.error;
    if (relatedError) throw relatedError;

    const membershipRows = (membershipResponse.data ?? []) as ProjectMemberRow[];
    const milestoneRows = (milestoneResponse.data ?? []) as MilestoneRow[];
    const taskRows = (taskResponse.data ?? []) as TaskRow[];
    const activityRows = (activityResponse.data ?? []) as ActivityRow[];
    const objectiveRows = (objectiveResponse.data ?? []) as ObjectiveRow[];
    const loadedObjectiveIds = new Set(objectiveRows.map(({ id }) => id));
    const missingParentObjectiveIds = [...new Set(objectiveRows.flatMap(({ parent_objective_id }) =>
      parent_objective_id == null || loadedObjectiveIds.has(parent_objective_id) ? [] : [parent_objective_id]))];
    const parentObjectiveResponse = missingParentObjectiveIds.length > 0
      ? await client
        .from("objectives")
        .select("id, public_id")
        .in("id", missingParentObjectiveIds)
        .is("deleted_at", null)
      : { data: [], error: null };
    if (parentObjectiveResponse.error) throw parentObjectiveResponse.error;
    const objectivePublicIds = new Map<number, string>([
      ...objectiveRows.map(({ id, public_id }) => [id, public_id] as const),
      ...((parentObjectiveResponse.data ?? []) as ObjectivePublicRow[]).map(({ id, public_id }) => [id, public_id] as const),
    ]);
    const memberDirectory = await loadProjectMemberDirectory(client, [
      ...projectRows.map(({ owner_member_id }) => owner_member_id),
      ...projectRows.map(({ created_by_member_id }) => created_by_member_id),
      ...objectiveRows.flatMap(({ owner_member_id, created_by_member_id }) => [owner_member_id, created_by_member_id]),
      ...membershipRows.map(({ member_id }) => member_id),
      ...milestoneRows.flatMap(({ owner_member_id }) => owner_member_id == null ? [] : [owner_member_id]),
      ...taskRows.flatMap(({ assignee_member_id }) => assignee_member_id == null ? [] : [assignee_member_id]),
      ...taskRows.map(({ reporter_member_id }) => reporter_member_id),
      ...activityRows.flatMap(({ actor_member_id }) => actor_member_id == null ? [] : [actor_member_id]),
      scope.memberId,
    ], scope);

    const objectives = new Map(
      objectiveRows.map((row) => [row.id, mapObjective(
        row,
        memberDirectory,
        scope.organizationPublicId,
        row.parent_objective_id == null ? undefined : objectivePublicIds.get(row.parent_objective_id),
      )]),
    );
    const membershipsByProject = new Map<number, ProjectMemberRow[]>();
    const milestonesByProject = new Map<number, MilestoneRow[]>();
    const tasksByProject = new Map<number, TaskRow[]>();
    const activitiesByProject = new Map<number, ActivityRow[]>();
    for (const row of membershipRows) membershipsByProject.set(row.project_id, [...(membershipsByProject.get(row.project_id) ?? []), row]);
    for (const row of milestoneRows) milestonesByProject.set(row.project_id, [...(milestonesByProject.get(row.project_id) ?? []), row]);
    for (const row of taskRows) tasksByProject.set(row.project_id, [...(tasksByProject.get(row.project_id) ?? []), row]);
    for (const row of activityRows) activitiesByProject.set(row.project_id, [...(activitiesByProject.get(row.project_id) ?? []), row]);

    const details = projectRows.map<ProjectDetailData>((projectRow) => {
      const memberRows = membershipsByProject.get(projectRow.id) ?? [];
      const members = memberRows.map<ProjectMember>((row) => ({
        id: row.public_id,
        organizationId: scope.organizationPublicId,
        projectId: projectRow.public_id,
        member: memberDirectory.get(row.member_id)?.summary ?? fallbackProjectMember(row.member_id, row.role),
        role: row.role,
        allocationPercent: asNumber(row.allocation_percent),
        joinedAt: row.joined_at,
        leftAt: row.left_at ?? undefined,
      }));
      const owner = memberDirectory.get(projectRow.owner_member_id)?.summary
        ?? members.find(({ role }) => role === "owner")?.member
        ?? fallbackProjectMember(projectRow.owner_member_id, "owner");
      const project: Project = {
        id: projectRow.public_id,
        organizationId: scope.organizationPublicId,
        objectiveId: projectRow.objective_id == null ? undefined : objectives.get(projectRow.objective_id)?.id,
        code: projectRow.code,
        name: projectRow.name,
        description: projectRow.description,
        category: projectRow.category,
        budgetAmount: asNumber(projectRow.budget_amount).toFixed(2),
        ownerId: owner.id,
        createdById: requiredMemberPublicId(memberDirectory, projectRow.created_by_member_id),
        status: projectRow.status,
        health: projectRow.health,
        priority: projectRow.priority,
        startDate: projectRow.start_date,
        dueDate: projectRow.due_date,
        actualEndDate: projectRow.actual_end_date ?? undefined,
        progress: asNumber(projectRow.progress),
        version: projectRow.version,
        createdAt: projectRow.created_at,
        updatedAt: projectRow.updated_at,
      };
      const projectMilestones = milestonesByProject.get(projectRow.id) ?? [];
      const milestonePublicIds = new Map(projectMilestones.map((row) => [row.id, row.public_id]));
      const milestones = projectMilestones.map<Milestone>((row) => ({
        id: row.public_id,
        organizationId: scope.organizationPublicId,
        projectId: project.id,
        ownerId: row.owner_member_id == null ? undefined : memberDirectory.get(row.owner_member_id)?.summary.id ?? String(row.owner_member_id),
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
      const projectTasks = tasksByProject.get(projectRow.id) ?? [];
      const taskPublicIds = new Map(projectTasks.map((row) => [row.id, row.public_id]));
      const tasks = projectTasks.map<ProjectTask>((row) => ({
        id: row.public_id,
        organizationId: scope.organizationPublicId,
        projectId: project.id,
        milestoneId: row.milestone_id == null ? undefined : milestonePublicIds.get(row.milestone_id),
        parentTaskId: row.parent_task_id == null ? undefined : taskPublicIds.get(row.parent_task_id),
        title: row.title,
        description: row.description,
        acceptanceCriteria: row.acceptance_criteria,
        assigneeId: row.assignee_member_id == null ? undefined : memberDirectory.get(row.assignee_member_id)?.summary.id ?? String(row.assignee_member_id),
        reporterId: memberDirectory.get(row.reporter_member_id)?.summary.id ?? String(row.reporter_member_id),
        status: row.status,
        priority: row.priority,
        startDate: row.start_date ?? undefined,
        dueDate: row.due_date ?? undefined,
        completedAt: row.completed_at ?? undefined,
        progress: asNumber(row.progress),
        estimatedHours: row.estimated_hours == null ? undefined : asNumber(row.estimated_hours),
        sortOrder: row.sort_order,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
      const activities = (activitiesByProject.get(projectRow.id) ?? []).map<ProjectActivity>((row) => ({
        id: row.public_id,
        organizationId: scope.organizationPublicId,
        projectId: project.id,
        userId: row.actor_member_id == null
          ? row.user_id
          : memberDirectory.get(row.actor_member_id)?.summary.id ?? row.user_id,
        actionType: row.action_type,
        content: row.content,
        createdAt: row.created_at,
      }));
      return {
        project,
        objective: projectRow.objective_id == null ? undefined : objectives.get(projectRow.objective_id),
        owner,
        members,
        milestones,
        tasks,
        comments: [],
        files: [],
        dailyReports: [],
        activities,
        risks: [],
        fileRelations: [],
      };
    });
    const viewerMember = memberDirectory.get(scope.memberId)?.summary;
    return {
      details,
      source: "supabase",
      viewer: { memberId: scope.memberPublicId, member: viewerMember },
      availableMembers,
    };
  } catch (error) {
    if (allowMockFallback) return mockResult();
    throw error;
  }
}
