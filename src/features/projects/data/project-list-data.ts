import {
  getProjectListMock,
  mockProjectMilestoneReminders,
  mockProjectPortfolioStats,
} from "@/features/projects/mock-data";
import {
  fallbackProjectMember,
  loadProjectMemberDirectory,
} from "@/features/projects/data/project-member-data";
import type {
  ProjectListItem,
  ProjectMilestoneReminder,
  ProjectPortfolioStat,
} from "@/features/projects/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateInputInTimeZone } from "@/lib/date";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type ProjectListClientFactory = () => Promise<SupabaseServerClient>;

export type ProjectListResult = {
  projects: readonly ProjectListItem[];
  stats: readonly ProjectPortfolioStat[];
  reminders: readonly ProjectMilestoneReminder[];
  source: "supabase" | "mock";
};

type ProjectRow = {
  id: number;
  public_id: string;
  organization_id: number;
  objective_id: number | null;
  code: string;
  name: string;
  owner_member_id: number;
  status: ProjectListItem["status"];
  health: ProjectListItem["health"];
  priority: ProjectListItem["priority"];
  start_date: string;
  due_date: string;
  progress: number | string;
};

type ProjectMemberRow = {
  public_id: string;
  project_id: number;
  member_id: number;
  role: ProjectListItem["viewerRole"];
  left_at: string | null;
};

type ObjectiveRow = {
  id: number;
  title: string;
};

type MilestoneRow = {
  public_id: string;
  project_id: number;
  name: string;
  due_date: string;
  status: "pending" | "in_progress" | "completed" | "overdue";
};

const projectStatusOrder: Record<ProjectListItem["status"], number> = {
  active: 0,
  planning: 1,
  on_hold: 2,
  completed: 3,
  cancelled: 4,
};

function asNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function mockResult(): ProjectListResult {
  return {
    projects: getProjectListMock(),
    stats: mockProjectPortfolioStats,
    reminders: mockProjectMilestoneReminders,
    source: "mock",
  };
}

function buildPortfolioStats(
  projects: readonly ProjectListItem[],
): ProjectPortfolioStat[] {
  const active = projects.filter(({ status }) => status === "active").length;
  const completed = projects.filter(({ status }) => status === "completed").length;
  const today = formatDateInputInTimeZone();
  const risk = projects.filter((project) => (
    project.health === "at_risk"
    || project.health === "off_track"
    || (project.status !== "completed" && project.dueDate < today)
  )).length;

  return [
    { id: "all", label: "全部项目", value: projects.length, trendLabel: "实时同步", trend: "当前", tone: "blue" },
    { id: "active", label: "进行中", value: active, trendLabel: "当前推进", trend: String(active), tone: "purple" },
    { id: "completed", label: "已完成", value: completed, trendLabel: "累计交付", trend: String(completed), tone: "green" },
    { id: "risk", label: "延期风险", value: risk, trendLabel: "需要关注", trend: String(risk), tone: "red" },
  ];
}

function reminderStatus(dueDate: string): ProjectMilestoneReminder["status"] {
  const today = formatDateInputInTimeZone();
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.ceil(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`))
      / millisecondsPerDay,
  );

  return daysRemaining <= 7 ? "urgent" : "upcoming";
}

function buildMilestoneReminders(
  milestones: readonly MilestoneRow[],
  projectsById: ReadonlyMap<number, ProjectRow>,
): ProjectMilestoneReminder[] {
  return milestones
    .filter(({ status }) => status !== "completed")
    .sort((left, right) => left.due_date.localeCompare(right.due_date))
    .slice(0, 3)
    .flatMap((milestone) => {
      const project = projectsById.get(milestone.project_id);
      return project
        ? [{
          id: milestone.public_id,
          projectName: project.name,
          milestoneName: milestone.name,
          dueDate: milestone.due_date,
          status: reminderStatus(milestone.due_date),
        }]
        : [];
    });
}

export async function loadProjectList(
  clientFactory: ProjectListClientFactory = getSupabaseServerClient,
  options: { allowMockFallback?: boolean } = {},
): Promise<ProjectListResult> {
  const allowMockFallback = options.allowMockFallback ?? true;

  try {
    const client = await clientFactory();
    const [projectResponse, userResponse] = await Promise.all([
      client
        .from("projects")
        .select("id, public_id, organization_id, objective_id, code, name, owner_member_id, status, health, priority, start_date, due_date, progress")
        .is("deleted_at", null)
        .order("due_date"),
      client.auth.getUser().catch(() => ({ data: { user: null }, error: null })),
    ]);

    if (projectResponse.error) {
      throw projectResponse.error;
    }

    const projectRows = (projectResponse.data ?? []) as ProjectRow[];
    if (projectRows.length === 0) {
      return { projects: [], stats: buildPortfolioStats([]), reminders: [], source: "supabase" };
    }

    const projectIds = projectRows.map(({ id }) => id);
    const objectiveIds = projectRows.flatMap(({ objective_id }) => objective_id == null ? [] : [objective_id]);
    const objectivePromise = objectiveIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : client
        .from("objectives")
        .select("id, title")
        .in("id", [...new Set(objectiveIds)])
        .is("deleted_at", null);
    const [membershipResponse, milestoneResponse, objectiveResponse] = await Promise.all([
      client
        .from("project_members")
        .select("public_id, project_id, member_id, role, left_at")
        .in("project_id", projectIds)
        .is("left_at", null),
      client
        .from("milestones")
        .select("public_id, project_id, name, due_date, status")
        .in("project_id", projectIds)
        .is("deleted_at", null)
        .order("due_date"),
      objectivePromise,
    ]);
    const relatedError = [membershipResponse, milestoneResponse, objectiveResponse]
      .find(({ error }) => error)?.error;
    if (relatedError) {
      throw relatedError;
    }

    const membershipRows = (membershipResponse.data ?? []) as ProjectMemberRow[];
    const memberIds = [
      ...projectRows.map(({ owner_member_id }) => owner_member_id),
      ...membershipRows.map(({ member_id }) => member_id),
    ];
    const memberDirectory = await loadProjectMemberDirectory(client, memberIds);
    const currentUserId = userResponse.data.user?.id;
    const objectives = new Map(
      ((objectiveResponse.data ?? []) as ObjectiveRow[]).map((objective) => [objective.id, objective.title]),
    );
    const membershipsByProject = new Map<number, ProjectMemberRow[]>();

    for (const membership of membershipRows) {
      const current = membershipsByProject.get(membership.project_id) ?? [];
      current.push(membership);
      membershipsByProject.set(membership.project_id, current);
    }

    const projects = projectRows
      .map<ProjectListItem>((project) => {
        const memberships = membershipsByProject.get(project.id) ?? [];
        const summaries = memberships.map((membership) => (
          memberDirectory.get(membership.member_id)?.summary
            ?? fallbackProjectMember(
              membership.member_id,
              membership.role === "none" ? "member" : membership.role,
            )
        ));
        const owner = memberDirectory.get(project.owner_member_id)?.summary
          ?? fallbackProjectMember(project.owner_member_id, "owner");
        const viewerMembership = currentUserId
          ? memberships.find(({ member_id }) => memberDirectory.get(member_id)?.userId === currentUserId)
          : undefined;
        const members = summaries.some(({ id }) => id === owner.id)
          ? summaries
          : [owner, ...summaries];

        return {
          id: project.public_id,
          code: project.code,
          name: project.name,
          objectiveTitle: project.objective_id == null
            ? undefined
            : objectives.get(project.objective_id),
          owner,
          members,
          memberCount: members.length,
          progress: asNumber(project.progress),
          status: project.status,
          health: project.health,
          priority: project.priority,
          startDate: project.start_date,
          dueDate: project.due_date,
          viewerRole: viewerMembership?.role ?? "none",
          isFollowed: false,
        };
      })
      .sort((left, right) => (
        projectStatusOrder[left.status] - projectStatusOrder[right.status]
        || left.dueDate.localeCompare(right.dueDate)
      ));
    const projectsById = new Map(projectRows.map((project) => [project.id, project]));
    const reminders = buildMilestoneReminders(
      (milestoneResponse.data ?? []) as MilestoneRow[],
      projectsById,
    );

    return {
      projects,
      stats: buildPortfolioStats(projects),
      reminders,
      source: "supabase",
    };
  } catch (error) {
    if (allowMockFallback) {
      return mockResult();
    }
    throw error;
  }
}
