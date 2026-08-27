import {
  createTaskNotificationRecoveryHandler,
  defaultTaskNotificationRecoveryDependencies,
} from "@/app/api/internal/task-notification-recovery/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createTaskNotificationRecoveryHandler(defaultTaskNotificationRecoveryDependencies);
