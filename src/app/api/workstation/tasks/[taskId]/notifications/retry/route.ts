import { createTaskNotificationRetryHandler, defaultTaskNotificationRetryDependencies } from "@/features/workstation/task-notification-retry-handler";

export const dynamic = "force-dynamic";
export const POST = createTaskNotificationRetryHandler(defaultTaskNotificationRetryDependencies);
