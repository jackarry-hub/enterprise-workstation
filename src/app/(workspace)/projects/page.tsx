import type { Metadata } from "next";

import { loadProjectList } from "@/features/projects/data/project-list-data";
import { ProjectsPage } from "@/features/projects/projects-page";

export const metadata: Metadata = {
  title: "项目管理中心 | 企业工作站",
};

export default async function ProjectsRoute() {
  const result = await loadProjectList();

  return <ProjectsPage result={result} />;
}
