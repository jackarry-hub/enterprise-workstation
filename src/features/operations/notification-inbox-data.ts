import "server-only";

import type { NotificationInboxItem, NotificationInboxResult } from "@/features/operations/notification-data";
import { shouldAllowMockBusinessData } from "@/lib/runtime/workstation-mode";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = new Set(["pending", "sending", "sent", "failed", "read"]);
type NotificationClientFactory = () => Promise<Awaited<ReturnType<typeof getSupabaseServerClient>>>;

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function time(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export async function loadNotificationInbox(
  clientFactory: NotificationClientFactory = getSupabaseServerClient,
): Promise<NotificationInboxResult> {
  if (shouldAllowMockBusinessData()) return { items: [], source: "mock" };
  try {
    const client = await clientFactory();
    const { data, error } = await client.rpc("current_task_notification_inbox");
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("notification_inbox_invalid");
    const items = data.map((raw) => {
      const row = raw as Record<string, unknown>;
      const id = uuid(row.notification_public_id);
      const eventId = uuid(row.event_public_id);
      const taskId = uuid(row.task_public_id);
      const projectId = uuid(row.project_public_id);
      const createdAt = time(row.created_at);
      const eventType = typeof row.event_type === "string" && ["task.assigned", "task.submitted", "task.review_passed", "task.review_rejected", "task.reopened"].includes(row.event_type)
        ? row.event_type as NotificationInboxItem["eventType"] : null;
      const status = typeof row.effective_status === "string" && states.has(row.effective_status)
        ? row.effective_status as NotificationInboxItem["status"] : null;
      if (!id || !eventId || !taskId || !projectId || !createdAt || !eventType || !status
        || typeof row.task_title !== "string" || typeof row.project_name !== "string"
        || typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 1
        || typeof row.can_retry !== "boolean") {
        throw new Error("notification_inbox_invalid");
      }
      return {
        id, eventId, eventType, status, taskId, taskTitle: row.task_title,
        projectId, projectName: row.project_name, createdAt,
        sentAt: time(row.sent_at) ?? undefined,
        readAt: time(row.read_at) ?? undefined,
        nextRetryAt: time(row.next_retry_at) ?? undefined,
        lastErrorCode: typeof row.last_error_code === "string" ? row.last_error_code : undefined,
        version: row.version, canRetry: row.can_retry,
      };
    });
    return { items, source: "supabase" };
  } catch {
    return { items: [], source: "unavailable", error: "通知服务当前不可用，请稍后刷新" };
  }
}
