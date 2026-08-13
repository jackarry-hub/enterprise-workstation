import {
  getProjectListMock,
  mockProjectMilestoneReminders,
  mockProjectPortfolioStats,
} from "@/features/projects/mock-data";
import type { ProjectListResult } from "@/features/projects/data/project-list-data";
import { MobileProjectsPage } from "@/features/mobile-workstation/mobile-projects-page";

const defaultResult: ProjectListResult = {
  projects: getProjectListMock(),
  stats: mockProjectPortfolioStats,
  reminders: mockProjectMilestoneReminders,
  source: "mock",
};

export function ProjectsPage({ result = defaultResult }: { result?: ProjectListResult }) {
  return (
    <MobileProjectsPage
      projects={result.projects}
      stats={result.stats}
      reminders={result.reminders}
    />
  );
}
