import { createHash, timingSafeEqual } from "node:crypto";

import { runDefaultExpiredFileUploadCleanup } from "@/features/files/file-command-handler";

export type FileUploadCleanupDependencies = {
  cronSecret: string | null;
  cleanup: () => Promise<{ claimed: number; removed: number; failed: number }>;
};

function configuredSecret(value: string | null): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 512
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function matches(authorization: string | null, secret: string) {
  const actual = createHash("sha256").update(authorization ?? "", "utf8").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  return timingSafeEqual(actual, expected);
}

function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function createFileUploadCleanupHandler(dependencies: FileUploadCleanupDependencies) {
  return async function handle(request: Request) {
    if (!configuredSecret(dependencies.cronSecret)) {
      return json({ error: "file_cleanup_unavailable" }, 503);
    }
    if (!matches(request.headers.get("authorization"), dependencies.cronSecret)) {
      return json({ error: "unauthorized" }, 401);
    }
    try {
      return json(await dependencies.cleanup(), 200);
    } catch {
      return json({ error: "file_cleanup_failed" }, 502);
    }
  };
}

export const defaultFileUploadCleanupDependencies: FileUploadCleanupDependencies = {
  cronSecret: process.env.FILE_UPLOAD_CLEANUP_CRON_SECRET ?? null,
  cleanup: () => runDefaultExpiredFileUploadCleanup(20),
};
