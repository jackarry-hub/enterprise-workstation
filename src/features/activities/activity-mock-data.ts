import type { ActivityProjectView } from "@/features/activities/activity-types";
import {
  mockMembers,
  mockObjectives,
  mockProjectMembers,
  mockProjects,
  mockTasks,
} from "@/features/projects/mock-data";
import type { Milestone, Project, ProjectDetailData } from "@/features/projects/types";

const activityProjects = [mockProjects[1], mockProjects[2], mockProjects[0]];

const stageProfiles: Record<string, readonly [number, number, number, number]> = {
  [mockProjects[1].id]: [100, 72, 0, 0],
  [mockProjects[2].id]: [55, 0, 0, 0],
  [mockProjects[0].id]: [100, 100, 68, 0],
};

const stageNames = ["策划", "执行", "推广", "复盘"] as const;

function milestoneStatus(progress: number): Milestone["status"] {
  if (progress >= 100) return "completed";
  if (progress > 0) return "in_progress";
  return "pending";
}

function buildStages(project: Project): Milestone[] {
  const profile = stageProfiles[project.id] ?? [0, 0, 0, 0];
  const dueDates = [project.startDate, project.dueDate, project.dueDate, project.dueDate];

  return stageNames.map((name, index) => {
    const progress = profile[index] ?? 0;
    const dueDate = dueDates[index] ?? project.dueDate;

    return {
    id: `activity-stage-${project.id}-${index + 1}`,
    organizationId: project.organizationId,
    projectId: project.id,
    ownerId: project.ownerId,
    name,
    description: `${name}阶段推进与交付检查。`,
    status: milestoneStatus(progress),
    startDate: index === 0 ? project.startDate : undefined,
    dueDate,
    completedAt: progress >= 100 ? `${dueDate}T09:00:00+08:00` : undefined,
    progress,
    sortOrder: index,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    };
  });
}

export const activityProjectViews: readonly ActivityProjectView[] = activityProjects.map((project) => {
  const owner = mockMembers.find(({ id }) => id === project.ownerId);

  if (!owner) {
    throw new Error(`Activity project ${project.id} does not have a mock owner.`);
  }

  return {
    project,
    objective: mockObjectives.find(({ id }) => id === project.objectiveId),
    owner,
    members: mockProjectMembers.filter(({ projectId, leftAt }) => projectId === project.id && !leftAt),
    stages: buildStages(project),
    tasks: mockTasks.filter(({ projectId }) => projectId === project.id),
  };
});

export function buildActivityProjectViews(
  details: readonly ProjectDetailData[],
  options: { syntheticStages?: boolean } = { syntheticStages: true },
): ActivityProjectView[] {
  return details.map((detail) => ({
    project: detail.project,
    objective: detail.objective,
    owner: detail.owner,
    members: detail.members,
    stages: options.syntheticStages ? buildStages(detail.project) : detail.milestones,
    tasks: detail.tasks,
  }));
}
