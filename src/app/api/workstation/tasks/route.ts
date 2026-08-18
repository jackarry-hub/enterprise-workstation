import {
  createWorkstationTaskCreateHandler,
  defaultWorkstationTaskCreateDependencies,
} from "@/app/api/workstation/tasks/handler";

export const dynamic = "force-dynamic";
export const POST = createWorkstationTaskCreateHandler(
  defaultWorkstationTaskCreateDependencies,
);
