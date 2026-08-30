// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { markBusinessNotificationRead, retryBusinessNotification } from "@/features/operations/notification-data";
import { loadNotificationInbox } from "@/features/operations/notification-inbox-data";

const notificationId = "8a000000-0000-4000-8000-000000000001";

describe("formal notification inbox data", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps canonical recipient state and the database project retry capability", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      notification_public_id: notificationId,
      event_public_id: "8a000000-0000-4000-8000-000000000002",
      event_type: "task.submitted",
      category: "task",
      effective_status: "failed",
      entity_type: "task",
      entity_public_id: "8a000000-0000-4000-8000-000000000003",
      title: "验收真实交付",
      summary: "项目：商用整改",
      target_path: "/projects/8a000000-0000-4000-8000-000000000004?tab=tasks",
      created_at: "2026-08-28T01:00:00.000Z",
      sent_at: null,
      read_at: null,
      next_retry_at: "2026-08-28T01:01:00.000Z",
      last_error_code: "send_failed",
      version: 4,
      can_retry: true,
    }], error: null });
    const result = await loadNotificationInbox(async () => ({ rpc } as never));
    expect(result).toEqual({ source: "supabase", items: [expect.objectContaining({
      id: notificationId,
      status: "failed",
      version: 4,
      canRetry: true,
    })] });
  });

  it("fails closed when the RPC omits canonical authorization metadata", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      notification_public_id: notificationId,
      event_public_id: "8a000000-0000-4000-8000-000000000002",
      event_type: "task.assigned",
      category: "task",
      effective_status: "pending",
      entity_type: "task",
      entity_public_id: "8a000000-0000-4000-8000-000000000003",
      title: "任务",
      summary: "项目：项目",
      target_path: "/projects/8a000000-0000-4000-8000-000000000004?tab=tasks",
      created_at: "2026-08-28T01:00:00.000Z",
      version: 1,
    }], error: null });
    await expect(loadNotificationInbox(async () => ({ rpc } as never))).resolves.toEqual({
      items: [], source: "unavailable", error: "通知服务当前不可用，请稍后刷新",
    });
  });

  it("uses the server canonical retry version and status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      outcome: "success", id: notificationId, version: 7, state: "sending",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(retryBusinessNotification(
      notificationId, 4, "8a000000-0000-4000-8000-000000000005",
    )).resolves.toEqual({ version: 7, state: "sending" });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workstation/notifications/${notificationId}/retry`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses the server canonical read timestamp and version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      outcome: "success", id: notificationId, state: "read",
      readAt: "2026-08-28T02:00:00.000Z", version: 5,
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(markBusinessNotificationRead(
      notificationId, "8a000000-0000-4000-8000-000000000006",
    )).resolves.toEqual({ readAt: "2026-08-28T02:00:00.000Z", version: 5 });
  });
});
