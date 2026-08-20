import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608200001_feishu_task_notifications.sql",
  "utf8",
);

describe("Feishu task notification migration", () => {
  it("creates a tenant-scoped idempotent delivery queue", () => {
    expect(sql).toMatch(/create table public\.task_notifications/i);
    expect(sql).toMatch(/tenant_id bigint not null/i);
    expect(sql).toMatch(/unique \(tenant_id, task_id, recipient_member_id, event_type\)/i);
    expect(sql).toMatch(/status in \('pending', 'sent', 'failed'\)/i);
  });

  it("queues assignments and exposes context only to service_role", () => {
    expect(sql).toMatch(/create trigger queue_task_assigned_notification/i);
    expect(sql).toMatch(/create or replace function public\.get_task_notification_delivery_context/i);
    expect(sql).toMatch(/create or replace function public\.record_task_notification_delivery/i);
    expect(sql).toMatch(/revoke all on function public\.get_task_notification_delivery_context[\s\S]*authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.get_task_notification_delivery_context[\s\S]*service_role/i);
  });
});
