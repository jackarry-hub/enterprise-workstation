import {
  createWorkProfileUpdateHandler,
  defaultWorkProfileUpdateDependencies,
} from "@/app/api/workstation/work-profile/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = createWorkProfileUpdateHandler(
  defaultWorkProfileUpdateDependencies,
);
