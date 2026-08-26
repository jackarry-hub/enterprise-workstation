import {
  createFeishuDirectorySyncCronHandler,
  defaultFeishuDirectorySyncCronDependencies,
} from "@/app/api/internal/feishu-directory-sync/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createFeishuDirectorySyncCronHandler(defaultFeishuDirectorySyncCronDependencies);
