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
    expect(sql).toMatch(/foreign key \(tenant_id, organization_id\)[\s\S]*references public\.organizations \(tenant_id, id\)/i);
    expect(sql).toMatch(/foreign key \(organization_id, task_id\)[\s\S]*references public\.tasks \(organization_id, id\)/i);
    expect(sql).toMatch(/foreign key \(organization_id, recipient_member_id\)[\s\S]*references public\.organization_members \(organization_id, id\)/i);
  });

  it("queues assignments and exposes context only to service_role", () => {
    expect(sql).toMatch(/create trigger queue_task_assigned_notification/i);
    expect(sql).toMatch(/create or replace function public\.get_task_notification_delivery_context/i);
    expect(sql).toMatch(/create or replace function public\.record_task_notification_delivery/i);
    expect(sql).toMatch(/revoke all on function public\.get_task_notification_delivery_context[\s\S]*authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.get_task_notification_delivery_context[\s\S]*service_role/i);
  });

  it("allows authenticated users to select only through RLS", () => {
    expect(sql).toMatch(/alter table public\.task_notifications enable row level security/i);
    expect(sql).toMatch(/grant select on public\.task_notifications to authenticated/i);
    expect(sql).not.toMatch(
      /grant\s+[^;]*\b(?:insert|update|delete|all)\b[^;]*\bon\s+(?:table\s+)?public\.task_notifications[^;]*\bto\b[^;]*\bauthenticated\b/i,
    );
  });

  it("keeps delivery result writes service-role-only and atomic", () => {
    expect(sql).toMatch(
      /revoke all on function public\.record_task_notification_delivery\(uuid,uuid,uuid,text,text,text\)[\s\S]*from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_task_notification_delivery\(uuid,uuid,uuid,text,text,text\)[\s\S]*to service_role/i,
    );
    expect(sql).toMatch(/attempt_count = notification\.attempt_count \+ 1/i);
    expect(sql).toMatch(
      /feishu_message_id = case when p_status = 'sent' then p_feishu_message_id else null end/i,
    );
    expect(sql).toMatch(
      /last_error_code = case when p_status = 'failed' then p_last_error_code else null end/i,
    );
    expect(sql).toMatch(
      /sent_at = case when p_status = 'sent' then now\(\) else notification\.sent_at end/i,
    );
  });
});
