const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NotificationInboxItem = {
  id: string;
  eventId: string;
  eventType: "task.assigned" | "task.submitted" | "task.review_passed" | "task.review_rejected" | "task.reopened";
  status: "pending" | "sending" | "sent" | "failed" | "read";
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  sentAt?: string;
  readAt?: string;
  nextRetryAt?: string;
  lastErrorCode?: string;
  version: number;
  canRetry: boolean;
};

export type NotificationInboxResult = {
  items: readonly NotificationInboxItem[];
  source: "supabase" | "mock" | "unavailable";
  error?: string;
};

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function time(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export async function markBusinessNotificationRead(notificationId: string, idempotencyKey: string) {
  let response: Response;
  try {
    response = await fetch(`/api/workstation/notifications/${notificationId}/read`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      body: "{}",
    });
  } catch { throw new Error("网络连接失败，已读结果未确认"); }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(response.status === 409 ? "通知尚未完成投递，暂不能标记已读" : "标记已读失败，请稍后重试");
  const version = payload ? Number(payload.version) : 0;
  if (payload?.outcome !== "success" || uuid(payload.id) !== uuid(notificationId)
    || payload.state !== "read" || !time(payload.readAt)
    || !Number.isSafeInteger(version) || version < 1) {
    throw new Error("已读结果无法确认，请刷新通知中心核对");
  }
  return { readAt: payload.readAt as string, version };
}

export async function retryBusinessNotification(notificationId: string, version: number, idempotencyKey: string) {
  let response: Response;
  try {
    response = await fetch(`/api/workstation/notifications/${notificationId}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ expectedVersion: version, reason: "从通知中心授权重试失败投递" }),
    });
  } catch { throw new Error("网络连接失败，重试结果未确认"); }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(response.status === 403 ? "你没有该项目的通知重试权限" : response.status === 409 ? "通知状态已变化，请刷新后重试" : "通知重试失败，请稍后再试");
  const nextVersion = payload ? Number(payload.version) : 0;
  const state = payload?.state;
  if (payload?.outcome !== "success" || uuid(payload.id) !== uuid(notificationId)
    || !Number.isSafeInteger(nextVersion) || nextVersion < 1
    || typeof state !== "string" || !["pending", "sending", "sent", "failed"].includes(state)) {
    throw new Error("通知重试结果无法确认，请刷新核对");
  }
  return { version: nextVersion, state: state as "pending" | "sending" | "sent" | "failed" };
}
