import type { Metadata } from "next";

import { isCustomerDemoMode } from "@/features/demo/customer-demo-mode";
import { loadProjectList } from "@/features/projects/data/project-list-data";
import { ProjectsPage } from "@/features/projects/projects-page";

export const metadata: Metadata = {
  title: "项目管理中心 | 量子智枢",
};

export default async function ProjectsRoute() {
  if (isCustomerDemoMode()) {
    return <ProjectsPage />;
  }

  const result = await loadProjectList();

  return <ProjectsPage result={result} />;
}
