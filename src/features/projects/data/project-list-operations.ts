import { mockMembers } from "@/features/projects/mock-data";
import type {
  ProjectDetailData,
  ProjectListItem,
  ProjectPortfolioStat,
} from "@/features/projects/types";

const projectStatusOrder: Record<ProjectListItem["status"], number> = {
  active: 0,
  planning: 1,
  on_hold: 2,
  completed: 3,
  cancelled: 4,
};

function sortProjects(left: ProjectListItem, right: ProjectListItem) {
  return projectStatusOrder[left.status] - projectStatusOrder[right.status]
    || left.dueDate.localeCompare(right.dueDate)
    || left.code.localeCompare(right.code);
}

export function projectDetailToListItem(detail: ProjectDetailData): ProjectListItem {
  const activeMemberships = detail.members.filter(({ leftAt }) => !leftAt);
  const viewerMembership = activeMemberships.find(
    ({ member }) => member.id === mockMembers[0].id,
  );

  return {
    id: detail.project.id,
    code: detail.project.code,
    name: detail.project.name,
    objectiveTitle: detail.objective?.title,
    owner: detail.owner,
    members: activeMemberships.map(({ member }) => member),
    memberCount: activeMemberships.length,
    progress: detail.project.progress,
    status: detail.project.status,
    health: detail.project.health,
    priority: detail.project.priority,
    startDate: detail.project.startDate,
    dueDate: detail.project.dueDate,
    viewerRole: viewerMembership?.role ?? "none",
    isFollowed: false,
  };
}

export function mergeProjectList(
  base: readonly ProjectListItem[],
  local: readonly ProjectDetailData[],
) {
  const byId = new Map(base.map((project) => [project.id, project]));

  for (const detail of local) {
    byId.set(detail.project.id, projectDetailToListItem(detail));
  }

  return [...byId.values()].sort(sortProjects);
}

function countByCategory(projects: readonly ProjectListItem[]) {
  return {
    all: projects.length,
    active: projects.filter(({ status }) => status === "active").length,
    completed: projects.filter(({ status }) => status === "completed").length,
    risk: projects.filter(({ health }) => health === "at_risk" || health === "off_track").length,
  };
}

export function mergePortfolioStats(
  baseStats: readonly ProjectPortfolioStat[],
  baseProjects: readonly ProjectListItem[],
  mergedProjects: readonly ProjectListItem[],
): ProjectPortfolioStat[] {
  const before = countByCategory(baseProjects);
  const after = countByCategory(mergedProjects);

  return baseStats.map((stat) => ({
    ...stat,
    value: Math.max(0, stat.value + after[stat.id] - before[stat.id]),
  }));
}
