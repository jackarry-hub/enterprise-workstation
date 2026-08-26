import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationSource = () => readFileSync(path.join(process.cwd(), "supabase/migrations/202608270002_feishu_sync_control.sql"), "utf8");
const migration = () => migrationSource().toLowerCase();

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

  it("is parse-clean and uses only current post-048 function and conflict signatures", () => {
    const source = migrationSource();
    const sql = source.toLowerCase();
    expect(source).not.toMatch(/^\+/m);
    expect(sql).not.toContain("on conflict (tenant_id, identity_provider_id)");
    expect(sql).toContain("on conflict (tenant_id, organization_id, identity_provider_id)");
    expect(sql).toContain("apply_feishu_directory_sync_exact(uuid, uuid, uuid, uuid, jsonb)");
    expect(sql).not.toContain("apply_feishu_directory_sync_exact(uuid, uuid, uuid, jsonb)");
    expect(sql).not.toMatch(/grant execute on function public\.apply_feishu_directory_sync_exact/);
  });

  it("uses the claimed run as the only apply/idempotency anchor and closes legacy policy OR paths", () => {
    const sql = migration();
    const exactApply = sql.slice(
      sql.indexOf("create or replace function public.apply_feishu_directory_sync_exact"),
      sql.indexOf("create table public.feishu_offboarding_commands"),
    );
    const claim = sql.slice(
      sql.indexOf("create function public.claim_feishu_sync_work("),
      sql.indexOf("create or replace function public.heartbeat_feishu_sync_work"),
    );
    expect(sql).toContain("insert into public.directory_sync_runs");
    expect(sql).toContain("request_id");
    expect(exactApply).not.toContain("insert into public.directory_sync_runs");
    expect(exactApply).toContain("where run.public_id = p_run_id");
    expect(claim).toContain("v_actor_member_id bigint");
    expect(sql).toContain("drop policy if exists directory_sync_runs_admin_select");
    expect(sql).toContain("permission.code = 'organization.manage'");
  });

  it("keeps offboarding idempotency event-only and records complete revocation proof", () => {
    const sql = migration();
    const tableStart = sql.lastIndexOf("create table public.feishu_offboarding_commands");
    const commandTable = sql.slice(
      tableStart,
      sql.indexOf("create or replace function public.revoke_departed_member_access", tableStart),
    );
    expect(commandTable).toContain("unique (offboarding_event_id)");
    expect(commandTable).not.toContain("unique (tenant_id, organization_id, member_public_id)");
    expect(sql).toContain("sessions_revoked");
    expect(sql).toContain("refresh_tokens_revoked");
    expect(sql).toContain("queued_grants_cancelled");
    expect(sql).toContain("get_feishu_offboarding_proof");
  });

  it("installs exact-workspace replacements for every legacy directory read policy", () => {
    const sql = migration();
    expect(sql).toContain("having count(distinct identity.organization_id) = 1");
    expect(sql).toContain("create policy directory_connections_org_manager_select");
    expect(sql).toContain("create policy directory_entity_links_org_manager_select");
    expect(sql).toContain("create policy directory_sync_issues_org_manager_select");
    expect(sql).toContain("create policy directory_sync_runs_org_manager_select");
  });

  it("keeps retry audit variables in the finish transaction and persists cross-org conflicts", () => {
    const sql = migration();
    const finish = sql.slice(
      sql.indexOf("create function public.finish_feishu_sync_work(", sql.indexOf("drop function if exists public.finish_feishu_sync_work")),
      sql.indexOf("create or replace function public.resolve_feishu_sync_issue", sql.indexOf("drop function if exists public.finish_feishu_sync_work")),
    );
    expect(finish).toContain("v_audit_actor_auth_user_id uuid");
    expect(finish).toContain("v_audit_actor_member_id bigint");
    expect(sql).toContain("identity.organization_id <> v_organization_id");
    expect(sql).toContain("'ambiguous_event', 'error', 'user'");
  });
});
