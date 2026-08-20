import {
  createWorkstationTaskNotifyHandler,
  defaultWorkstationTaskNotifyDependencies,
} from "@/app/api/workstation/tasks/[taskId]/notify/handler";

export const dynamic = "force-dynamic";
export const POST = createWorkstationTaskNotifyHandler(
  defaultWorkstationTaskNotifyDependencies,
);
