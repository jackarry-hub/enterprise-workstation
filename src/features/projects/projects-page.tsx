import {
  getProjectListMock,
  mockProjectMilestoneReminders,
  mockProjectPortfolioStats,
} from "@/features/projects/mock-data";
import type { ProjectListResult } from "@/features/projects/data/project-list-data";
import { ProjectsWorkspace } from "@/features/projects/projects-workspace";

const defaultResult: ProjectListResult = {
  projects: getProjectListMock(),
  stats: mockProjectPortfolioStats,
  reminders: mockProjectMilestoneReminders,
  source: "mock",
};

export function ProjectsPage({ result = defaultResult }: { result?: ProjectListResult }) {
  return (
    <ProjectsWorkspace
      projects={result.projects}
      stats={result.stats}
      reminders={result.reminders}
    />
  );
}
