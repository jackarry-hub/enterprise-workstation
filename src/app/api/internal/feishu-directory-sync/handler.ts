import { createHash, timingSafeEqual } from "node:crypto";

import {
  runScheduledFeishuDirectorySync,
  type DirectorySyncControlResult,
} from "@/features/feishu/directory-sync-worker";

export type FeishuDirectorySyncCronDependencies = {
  cronSecret: string | null;
  run: () => Promise<DirectorySyncControlResult>;
};

function validSecret(value: string | null): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 512
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function matches(value: string | null, secret: string) {
  const actual = createHash("sha256").update(value ?? "", "utf8").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  return timingSafeEqual(actual, expected);
}

function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export function createFeishuDirectorySyncCronHandler(dependencies: FeishuDirectorySyncCronDependencies) {
  return async function scheduledSync(request: Request) {
    if (!validSecret(dependencies.cronSecret)) return json({ error: "directory_sync_unavailable" }, 503);
    if (!matches(request.headers.get("authorization"), dependencies.cronSecret)) return json({ error: "unauthorized" }, 401);
    try {
      return json(await dependencies.run(), 200);
    } catch {
      return json({ error: "directory_sync_failed" }, 502);
    }
  };
}

export const defaultFeishuDirectorySyncCronDependencies: FeishuDirectorySyncCronDependencies = {
  cronSecret: process.env.FEISHU_DIRECTORY_SYNC_CRON_SECRET ?? null,
  run: runScheduledFeishuDirectorySync,
};
