import type { Metadata } from "next";

import { TaskCenterPage } from "@/features/tasks/task-center-page";
import { loadProjectCollection } from "@/features/projects/data/project-collection-data";

export const metadata: Metadata = {
  title: "任务管理 | 企业工作站",
};

export const dynamic = "force-dynamic";

export default async function TasksRoute() {
  const result = await loadProjectCollection();
  return <TaskCenterPage result={result} />;
}
