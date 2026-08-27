import { createHash, timingSafeEqual } from "node:crypto";

import { runDefaultTaskNotificationRecovery, type TaskNotificationRecoveryResult } from "@/features/workstation/task-notification-recovery";

export type TaskNotificationRecoveryDependencies = {
  cronSecret: string | null;
  recover: () => Promise<TaskNotificationRecoveryResult>;
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

export function createTaskNotificationRecoveryHandler(dependencies: TaskNotificationRecoveryDependencies) {
  return async function handle(request: Request) {
    if (!configuredSecret(dependencies.cronSecret)) {
      return json({ error: "notification_recovery_unavailable" }, 503);
    }
    if (!matches(request.headers.get("authorization"), dependencies.cronSecret)) {
      return json({ error: "unauthorized" }, 401);
    }
    try {
      return json(await dependencies.recover(), 200);
    } catch {
      return json({ error: "notification_recovery_failed" }, 502);
    }
  };
}

export const defaultTaskNotificationRecoveryDependencies: TaskNotificationRecoveryDependencies = {
  cronSecret: process.env.TASK_NOTIFICATION_RECOVERY_CRON_SECRET ?? null,
  recover: () => runDefaultTaskNotificationRecovery(50),
};
