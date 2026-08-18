import {
  createWorkstationTaskHandler,
  defaultWorkstationTaskDependencies,
} from "@/app/api/workstation/tasks/[taskId]/handler";

export const dynamic = "force-dynamic";
export const PATCH = createWorkstationTaskHandler(
  defaultWorkstationTaskDependencies,
);
