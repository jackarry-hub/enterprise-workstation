import {
  createDirectorySyncHandler,
  defaultDirectorySyncDependencies,
} from "@/app/api/workstation/directory-sync/handler";

export const dynamic = "force-dynamic";
export const POST = createDirectorySyncHandler(defaultDirectorySyncDependencies);
