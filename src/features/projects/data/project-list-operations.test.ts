import { describe, expect, it } from "vitest";

import {
  mergePortfolioStats,
  mergeProjectList,
  projectDetailToListItem,
} from "@/features/projects/data/project-list-operations";
import {
  getProjectDetailMock,
  getProjectListMock,
  mockMembers,
  mockProjectPortfolioStats,
  mockProjects,
} from "@/features/projects/mock-data";
import type { ProjectDetailData } from "@/features/projects/types";

function createLocalFixture(overrides: Partial<ProjectDetailData["project"]> = {}): ProjectDetailData {
  const base = getProjectDetailMock(mockProjects[0].id);

  if (!base) {
    throw new Error("Expected a project detail fixture.");
  }

  const project = {
    ...base.project,
    id: "project-local-1",
    code: "PRJ-2026-025",
    name: "客户门户二期",
    ownerId: mockMembers[0].id,
    progress: 0,
    status: "active" as const,
    startDate: "2026-08-10",
    dueDate: "2026-10-30",
    ...overrides,
  };

  return {
    ...base,
    project,
    owner: mockMembers[0],
    members: base.members.map((membership, index) => ({
      ...membership,
      id: `local-membership-${index + 1}`,
      projectId: project.id,
    })),
    milestones: [],
    tasks: [],
    comments: [],
    files: [],
    dailyReports: [],
    activities: [],
    risks: [],
    fileRelations: [],
  };
}

describe("project list operations", () => {
  it("adds new projects and lets local records override matching defaults", () => {
    const baseProjects = getProjectListMock();
    const matching = getProjectDetailMock(mockProjects[0].id);

    if (!matching) {
      throw new Error("Expected matching detail.");
    }

    const localOverride = {
      ...matching,
      project: { ...matching.project, progress: 75 },
    };
    const localCreated = createLocalFixture();
    const merged = mergeProjectList(baseProjects, [localOverride, localCreated]);

    expect(merged.find(({ id }) => id === mockProjects[0].id)?.progress).toBe(75);
    expect(merged.some(({ id }) => id === "project-local-1")).toBe(true);
  });

  it("maps active memberships and the current member role into a list item", () => {
    const detail = createLocalFixture();
    const listItem = projectDetailToListItem(detail);

    expect(listItem).toMatchObject({
      id: "project-local-1",
      owner: mockMembers[0],
      memberCount: detail.members.length,
      viewerRole: "owner",
    });
  });

  it("applies local deltas without replacing the portfolio baseline", () => {
    const baseProjects = getProjectListMock();
    const merged = mergeProjectList(baseProjects, [createLocalFixture()]);
    const stats = mergePortfolioStats(mockProjectPortfolioStats, baseProjects, merged);

    expect(stats.map(({ value }) => value)).toEqual([25, 17, 6, 2]);
  });
});
