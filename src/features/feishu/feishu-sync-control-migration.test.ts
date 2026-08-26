import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = () => readFileSync(path.join(process.cwd(), "supabase/migrations/202608270002_feishu_sync_control.sql"), "utf8").toLowerCase();

describe("Feishu synchronization control migration", () => {
  it("is forward-only and creates durable OAuth, webhook, lease and issue controls", () => {
    const sql = migration();
    expect(sql).toContain("create table public.feishu_oauth_attempts");
    expect(sql).toContain("nonce_digest");
    expect(sql).not.toContain("raw_nonce");
    expect(sql).toContain("create table public.feishu_webhook_events");
    expect(sql).toContain("provider_event_id");
    expect(sql).toContain("entity_sequence");
    expect(sql).toContain("create table public.feishu_sync_leases");
    expect(sql).toContain("retry_after");
    expect(sql).toContain("revoke_departed_member_access");
    expect(sql).toContain("delete from auth.sessions");
    expect(sql).toContain("delete from auth.refresh_tokens");
    expect(sql).toContain("resolve_feishu_sync_issue");
    expect(sql).toContain("'employee_skill.verification_failed'");
    expect(sql).toContain("'directory.sync_issue_resolved'");
  });

  it("keeps control commands service-only and issue reads organization-bound", () => {
    const sql = migration();
    expect(sql).toMatch(/revoke all on function public\.consume_feishu_oauth_attempt[\s\S]*from public, anon, authenticated, service_role/);
    expect(sql).toMatch(/grant execute on function public\.consume_feishu_oauth_attempt[\s\S]*to service_role/);
    expect(sql).toContain("organization.manage");
    expect(sql).toContain("organization_id");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
  });

  it("fences apply/offboarding and binds issue access to the exact active workspace", () => {
    const sql = migration();
    expect(sql).toContain("apply_feishu_directory_sync_fenced");
    expect(sql).toContain("for update");
    expect(sql).toContain("lease_expires_at > now()");
    expect(sql).toContain("identity.provider_subject = 'open_id:' || lower(btrim(p_entity_external_id))");
    expect(sql).toContain("current_active_workspace_organization_id");
    expect(sql).toContain("offboarding_event_id");
    expect(sql).toContain("active_lease");
    expect(sql).toContain("no_connection");
    expect(sql).toContain("invalid_cursor");
  });
});
