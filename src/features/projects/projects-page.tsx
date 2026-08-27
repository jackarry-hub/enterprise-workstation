import {
  getProjectListMock,
  mockMembers,
  mockProjectMilestoneReminders,
  mockProjectPortfolioStats,
} from "@/features/projects/mock-data";
import type { ProjectListResult } from "@/features/projects/data/project-list-data";
import { ProjectsWorkspace } from "@/features/projects/projects-workspace";

const defaultResult: ProjectListResult = {
  projects: getProjectListMock(),
  stats: mockProjectPortfolioStats,
  reminders: mockProjectMilestoneReminders,
  availableMembers: mockMembers,
  source: "mock",
  archivedProjects: [],
};

export function ProjectsPage({ result = defaultResult }: { result?: ProjectListResult }) {
  return (
    <ProjectsWorkspace
      projects={result.projects}
      stats={result.stats}
      reminders={result.reminders}
      members={result.availableMembers}
      source={result.source}
      archivedProjects={result.archivedProjects}
    />
  );
}
