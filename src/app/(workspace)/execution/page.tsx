import type { Metadata } from "next";

import { loadWorkspaceData } from "@/features/tasks/workspace-data";
import { WorkspacePage } from "@/features/tasks/workspace-page";

export const metadata: Metadata = {
  title: "个人执行台 | 企业工作站",
};

export const dynamic = "force-dynamic";

export default async function ExecutionWorkbenchPage() {
  const result = await loadWorkspaceData();
  return <WorkspacePage result={result} />;
}

