import {
  createWorkstationProjectCreateHandler,
  defaultWorkstationProjectCreateDependencies,
} from "@/app/api/workstation/projects/handler";

export const dynamic = "force-dynamic";
export const POST = createWorkstationProjectCreateHandler(
  defaultWorkstationProjectCreateDependencies,
);
