import {
  createDirectorySyncHandler,
  defaultDirectorySyncDependencies,
} from "@/app/api/workstation/directory-sync/handler";

export const dynamic = "force-dynamic";
const handlePost = createDirectorySyncHandler(defaultDirectorySyncDependencies);
export function POST(request: Request) {
  return handlePost(request);
}
