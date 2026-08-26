import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationSource = () => readFileSync(path.join(process.cwd(), "supabase/migrations/202608270002_feishu_sync_control.sql"), "utf8");
const migration = () => migrationSource().toLowerCase();
const pgTapSource = () => readFileSync(path.join(process.cwd(), "supabase/tests/feishu_sync_control.sql"), "utf8").toLowerCase();

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

  it("authorizes every manager path through an enabled authoritative exact-organization role", () => {
    const sql = migration();
    const finalPolicyStart = sql.lastIndexOf("drop policy if exists feishu_sync_conflicts_manager_select");
    const finalPolicies = sql.slice(finalPolicyStart, sql.indexOf("drop function if exists public.claim_feishu_sync_work", finalPolicyStart));
    const claimStart = sql.lastIndexOf("create function public.claim_feishu_sync_work(");
    const claim = sql.slice(claimStart, sql.indexOf("create or replace function public.heartbeat_feishu_sync_work", claimStart));
    const exactStart = sql.indexOf("create or replace function public.apply_feishu_directory_sync_exact");
    const exactApply = sql.slice(exactStart, sql.indexOf("create table public.feishu_offboarding_commands", exactStart));
    const fencedStart = sql.lastIndexOf("create or replace function public.apply_feishu_directory_sync_fenced");
    const fencedApply = sql.slice(fencedStart, sql.indexOf("drop function if exists public.finish_feishu_sync_work", fencedStart));
    const resolveStart = sql.lastIndexOf("create or replace function public.resolve_feishu_sync_issue");
    const resolve = sql.slice(resolveStart);

    for (const block of [claim, exactApply, fencedApply, resolve]) {
      expect(block).toContain("join public.roles role");
      expect(block).toContain("role.tenant_id = assignment.tenant_id");
      expect(block).toContain("role.id = assignment.role_id");
      expect(block).toContain("role.is_enabled");
      expect(block).toContain("role.organization_id is null");
    }
    expect(claim.match(/join public\.roles role/g)).toHaveLength(2);
    expect(finalPolicies.match(/join public\.roles role/g)).toHaveLength(6);
    expect(finalPolicies.match(/role\.is_enabled/g)).toHaveLength(6);
    expect(finalPolicies.match(/role\.organization_id is null/g)).toHaveLength(6);
  });

  it("routes an incremental cursor directly and selects eligible unscoped work without starvation", () => {
    const sql = migration();
    const claimStart = sql.lastIndexOf("create function public.claim_feishu_sync_work(");
    const claim = sql.slice(claimStart, sql.indexOf("create or replace function public.heartbeat_feishu_sync_work", claimStart));

    expect(claim).toContain("join public.feishu_webhook_events cursor_event");
    expect(claim).toContain("cursor_event.connection_id = connection.id");
    expect(claim).toContain("cursor_event.id::text = p_cursor");
    expect(claim.indexOf("cursor_event.id::text = p_cursor")).toBeLessThan(claim.indexOf("for update of connection"));
    expect(claim).toContain("left join public.feishu_sync_leases candidate_lease");
    expect(claim).toContain("candidate_lease.lease_expires_at <= now()");
    expect(claim).toContain("candidate_lease.retry_after <= now()");
    expect(claim).toContain("for update of connection skip locked");
    expect(claim).toContain("v_ready_rechecks");
    expect(claim).toContain("perform pg_sleep(0.05)");
    expect(claim).toContain("'reason', 'locked'");
    expect(claim).toContain("interval '250 milliseconds'");
  });

  it("uses connection then lease then run locking for claim, apply and finish", () => {
    const sql = migration();
    const claimStart = sql.lastIndexOf("create function public.claim_feishu_sync_work(");
    const claim = sql.slice(claimStart, sql.indexOf("create or replace function public.heartbeat_feishu_sync_work", claimStart));
    const exactStart = sql.indexOf("create or replace function public.apply_feishu_directory_sync_exact");
    const exactApply = sql.slice(exactStart, sql.indexOf("create table public.feishu_offboarding_commands", exactStart));
    const fencedStart = sql.lastIndexOf("create or replace function public.apply_feishu_directory_sync_fenced");
    const fencedApply = sql.slice(fencedStart, sql.indexOf("drop function if exists public.finish_feishu_sync_work", fencedStart));
    const finishStart = sql.lastIndexOf("create function public.finish_feishu_sync_work(");
    const finish = sql.slice(finishStart, sql.indexOf("create or replace function public.resolve_feishu_sync_issue", finishStart));

    expect(claim.indexOf("for update of connection")).toBeGreaterThan(-1);
    expect(claim.indexOf("for update of connection")).toBeLessThan(claim.indexOf("for update of lease"));
    expect(claim.indexOf("for update of lease")).toBeLessThan(claim.indexOf("for update of run"));
    expect(claim.indexOf("for update of run")).toBeLessThan(claim.indexOf("insert into public.feishu_sync_leases"));
    expect(claim.indexOf("insert into public.feishu_sync_leases")).toBeLessThan(claim.indexOf("insert into public.directory_sync_runs"));
    expect(exactApply).not.toContain("for update");

    for (const block of [fencedApply, finish]) {
      const connectionLock = block.indexOf("for update of connection");
      const leaseLock = block.indexOf("for update of lease");
      const runLock = block.indexOf("for update of run");
      expect(connectionLock).toBeGreaterThan(-1);
      expect(connectionLock).toBeLessThan(leaseLock);
      expect(leaseLock).toBeLessThan(runLock);
    }
  });

  it("exposes service-only exact access-boundary counts for offboarding E2E proof", () => {
    const sql = migration();
    expect(sql).toContain("get_feishu_member_access_proof");
    expect(sql).toContain("'sessioncount'");
    expect(sql).toContain("'refreshtokencount'");
    expect(sql).toContain("'queuedgrantcount'");
    expect(sql).toMatch(/revoke all on function public\.get_feishu_member_access_proof[\s\S]*from public, anon, authenticated, service_role/);
    expect(sql).toMatch(/grant execute on function public\.get_feishu_member_access_proof[\s\S]*to service_role/);
  });

  it("terminalizes an expired lease owner exactly once before cumulative takeover", () => {
    const sql = migration();
    const claimStart = sql.lastIndexOf("create function public.claim_feishu_sync_work(");
    const claim = sql.slice(claimStart, sql.indexOf("create or replace function public.heartbeat_feishu_sync_work", claimStart));

    expect(claim).toContain("v_superseded_run public.directory_sync_runs%rowtype");
    expect(claim).toContain("v_superseded_running boolean := false");
    expect(claim).toContain("run.public_id = v_lease.run_id");
    expect(claim).toContain("run.connection_id = v_connection.id");
    expect(claim).toContain("v_lease.status in ('running', 'retry')");
    expect(claim).toContain("least(v_lease.attempt + 1, 9)");
    expect(claim).toContain("status = 'failed'");
    expect(claim).toContain("completed_at = clock_timestamp()");
    expect(claim).toContain("'code', 'lease_expired_superseded'");
    expect(claim).toContain("'supersededbyrunid', v_run_id");
    expect(claim).toContain("'directory.sync_failed'");
  });

  it("keeps live fairness, lock-overlap and takeover proofs capability-gated but fail-closed", () => {
    const pgTap = pgTapSource();

    expect(pgTap).toContain("test.feishu_fair_busy");
    expect(pgTap).toContain("test.feishu_finish_busy");
    expect(pgTap).toContain("test.feishu_takeover_proof");
    expect(pgTap).toContain("dblink_is_busy");
    expect(pgTap).toContain("unscoped live claim skips locked organization a and acquires ready organization b");
    expect(pgTap).toContain("finish waits behind the apply connection-first lock");
    expect(pgTap).toContain("expired live lease terminalizes its old run");
    expect(pgTap).toContain("raise;");
    expect(pgTap).toContain("# skip dblink extension or local connection unavailable");
    expect(pgTap).toMatch(/if v_integer <> 0 then[\s\S]*?'feishu_lock_a', 'rollback'[\s\S]*?dblink_get_result[\s\S]*?'feishu_lock_b', 'rollback'[\s\S]*?raise exception 'feishu_fair_claim_blocked'/);
    expect(pgTap).toMatch(/if v_integer <> 1 then[\s\S]*?dblink_get_result[\s\S]*?'feishu_lock_a', 'rollback'[\s\S]*?'feishu_lock_b', 'rollback'[\s\S]*?raise exception 'feishu_finish_did_not_wait'/);
  });
});
