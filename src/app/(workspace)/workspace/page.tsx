import type { Metadata } from "next";

import { loadWorkspaceData } from "@/features/tasks/workspace-data";
import { WorkspacePage } from "@/features/tasks/workspace-page";

export const metadata: Metadata = {
  title: "工作中心 | 企业工作站",
};

export default async function WorkspaceRoute() {
  const result = await loadWorkspaceData(undefined, { allowMockFallback: true });

  return <WorkspacePage result={result} />;
}
