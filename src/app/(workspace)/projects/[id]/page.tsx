import type { Metadata } from "next";

import { isCustomerDemoMode } from "@/features/demo/customer-demo-mode";
import { loadProjectDetail } from "@/features/projects/data/project-detail-data";
import { ProjectDetailPage } from "@/features/projects/project-detail-page";
import { getProjectDetailMock, mockProjects } from "@/features/projects/mock-data";

export const metadata: Metadata = {
  title: "项目详情 | 量子智枢",
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
  const demoMode = isCustomerDemoMode();
  const demoDetail = demoMode ? getProjectDetailMock(id) : undefined;
  const initialResult = demoDetail
    ? { detail: demoDetail, source: "mock" as const }
    : demoMode
      ? undefined
      : await loadProjectDetail(id);

  return <ProjectDetailPage projectId={id} initialResult={initialResult} />;
}
