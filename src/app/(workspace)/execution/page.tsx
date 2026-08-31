import type { Metadata } from "next";

import { loadProjectCollection } from "@/features/projects/data/project-collection-data";
import { TaskCenterPage } from "@/features/tasks/task-center-page";

export const metadata: Metadata = {
  title: "个人执行台 | 企业工作站",
};

export const dynamic = "force-dynamic";

export default async function ExecutionWorkbenchPage() {
  const result = await loadProjectCollection();
  return <TaskCenterPage result={result} />;
}

