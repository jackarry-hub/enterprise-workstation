import { describe, expect, it } from "vitest";

import {
  getDefaultProjectDetails,
  getEffectiveProjectDetails,
  mergeEffectiveProjectDetails,
} from "@/features/projects/data/effective-project-details";
import { getProjectDetailMock, mockProjects } from "@/features/projects/mock-data";
import type { ProjectDetailData } from "@/features/projects/types";

function defaultDetail(index = 0) {
  const detail = getProjectDetailMock(mockProjects[index].id);
  if (!detail) {
    throw new Error("Expected a project detail fixture.");
  }
  return detail;
}

describe("effective project details", () => {
  it("uses a local project to replace the default project with the same id", () => {
    const source = defaultDetail();
    const localProject: ProjectDetailData = {
      ...source,
      project: { ...source.project, progress: 88 },
    };

    const result = mergeEffectiveProjectDetails([source], [localProject]);

    expect(result).toEqual([localProject]);
  });

  it("keeps default ordering and appends browser-created projects", () => {
    const source = defaultDetail();
    const createdProject: ProjectDetailData = {
      ...source,
      project: {
        ...source.project,
        id: "project-local-1",
        code: "PRJ-2026-099",
        name: "客户门户二期",
      },
      members: source.members.map((membership) => ({
        ...membership,
        projectId: "project-local-1",
      })),
      tasks: [],
      milestones: [],
    };

    const result = mergeEffectiveProjectDetails([source], [createdProject]);

    expect(result.map(({ project }) => project.id)).toEqual([
      source.project.id,
      createdProject.project.id,
    ]);
  });

  it("returns all default details when no local projects exist", () => {
    expect(getEffectiveProjectDetails([])).toEqual(getDefaultProjectDetails());
    expect(getDefaultProjectDetails()).toHaveLength(mockProjects.length);
  });
});
