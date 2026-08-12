import type { Metadata } from "next";

import { loadProjectDetail } from "@/features/projects/data/project-detail-data";
import { ProjectDetailPage } from "@/features/projects/project-detail-page";
import { mockProjects } from "@/features/projects/mock-data";

export const metadata: Metadata = {
  title: "项目详情 | 企业工作站",
};

export function generateStaticParams() {
  return mockProjects.map(({ id }) => ({ id }));
}

export default async function ProjectDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialResult = await loadProjectDetail(id);

  return <ProjectDetailPage projectId={id} initialResult={initialResult} />;
}
