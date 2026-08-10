import { getProjectDetailMock, mockProjects } from "@/features/projects/mock-data";
import type { ProjectDetailData } from "@/features/projects/types";

export function getDefaultProjectDetails(): ProjectDetailData[] {
  return mockProjects.flatMap((project) => {
    const detail = getProjectDetailMock(project.id);
    return detail ? [detail] : [];
  });
}

export function mergeEffectiveProjectDetails(
  defaults: readonly ProjectDetailData[],
  localProjects: readonly ProjectDetailData[],
): ProjectDetailData[] {
  const localById = new Map(
    localProjects.map((detail) => [detail.project.id, detail]),
  );
  const merged = defaults.map(
    (detail) => localById.get(detail.project.id) ?? detail,
  );
  const defaultIds = new Set(defaults.map(({ project }) => project.id));

  return [
    ...merged,
    ...localProjects.filter(({ project }) => !defaultIds.has(project.id)),
  ];
}

export function getEffectiveProjectDetails(
  localProjects: readonly ProjectDetailData[] = [],
): ProjectDetailData[] {
  return mergeEffectiveProjectDetails(getDefaultProjectDetails(), localProjects);
}
