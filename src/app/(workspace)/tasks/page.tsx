import type { Metadata } from "next";

import { TaskCenterPage } from "@/features/tasks/task-center-page";

export const metadata: Metadata = {
  title: "任务管理 | 量子智枢",
};

export default function TasksRoute() {
  return <TaskCenterPage />;
}
