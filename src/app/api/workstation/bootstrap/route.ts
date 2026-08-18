import {
  createWorkstationBootstrapHandler,
  defaultWorkstationBootstrapDependencies,
} from "@/app/api/workstation/bootstrap/handler";

export const dynamic = "force-dynamic";
export const GET = createWorkstationBootstrapHandler(
  defaultWorkstationBootstrapDependencies,
);
