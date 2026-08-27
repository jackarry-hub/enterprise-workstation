import {
  createFileUploadCleanupHandler,
  defaultFileUploadCleanupDependencies,
} from "@/app/api/internal/file-upload-cleanup/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createFileUploadCleanupHandler(defaultFileUploadCleanupDependencies);
