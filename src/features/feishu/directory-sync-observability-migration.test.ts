import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "202608260048_directory_sync_observability.sql",
);

describe("directory sync observability migration contract", () => {
  it("binds exactly one service-only observed run to each tenant request ID", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");
    const observed = migration.match(
      /create or replace function public\.apply_feishu_directory_sync_observed\([\s\S]*?\$\$;/i,
    )?.[0].toLowerCase() ?? "";
    const failure = migration.match(
      /create or replace function public\.record_feishu_directory_sync_failure\([\s\S]*?\$\$;/i,
    )?.[0].toLowerCase() ?? "";

    expect(migration).toContain("add column if not exists request_id uuid");
    expect(migration).toContain("create unique index if not exists directory_sync_runs_tenant_request_id_uidx");
    expect(migration).toMatch(/where request_id is not null/i);
    expect(migration).toContain("drop constraint if exists directory_connections_tenant_id_identity_provider_id_key");
    expect(migration).toMatch(/create unique index if not exists directory_connections_tenant_organization_provider_uidx\s+on public\.directory_connections \(tenant_id, organization_id, identity_provider_id\)/i);
    expect(migration).toContain("pg_get_functiondef(");
    expect(migration).toContain("replace(v_definition, chr(13) || chr(10), chr(10))");
    expect(migration).toContain("using errcode = '55000'");
    expect(migration).toContain("on conflict (tenant_id, organization_id, identity_provider_id)");
    expect(observed).toContain("security definer");
    expect(observed).toContain("set search_path = ''");
    expect(observed).toContain("p_request_id uuid");
    expect(observed).toContain("p_snapshot -> 'complete'");
    expect(observed).toContain("<> 'true'::jsonb");
    expect(observed).toContain("role.code in ('owner', 'admin')");
    expect(observed).toContain("member.organization_id");
    expect(observed).toContain("role.is_system");
    expect(observed).toContain("role.organization_id is null");
    expect(observed).not.toContain("order by organization.id");
    expect(observed).toContain("hashtextextended('directory-sync:' || v_tenant_id::text, 0)");
    expect(observed).toContain("max(run.id)");
    expect(observed).toContain("public.apply_feishu_directory_sync(");
    expect(observed).toContain("run.id > v_before_run_id");
    expect(observed).toContain("run.request_id = p_request_id");
    expect(observed).not.toContain("order by run.id desc limit 1");

    expect(failure).toContain("security definer");
    expect(failure).toContain("set search_path = ''");
    expect(failure).toContain("p_request_id uuid");
    expect(failure).toContain("member.organization_id");
    expect(failure).toContain("role.is_system");
    expect(failure).toContain("role.organization_id is null");
    expect(failure).not.toContain("order by organization.id");
    expect(failure).toContain("hashtextextended('directory-sync:' || v_tenant_id::text, 0)");
    expect(failure).toMatch(/snapshot_complete,\s*departments_seen, employees_seen,\s*positions_seen, error_count, request_id/);
    expect(failure).toMatch(/'failed', false, 0, 0, 0, 1, p_request_id/);
    expect(failure).toContain("'directory.sync_failed'");
    expect(failure).toContain("p_code not in (");
    expect(failure).toContain("p_code is null");
    expect(failure).not.toMatch(/error\.message|sqlerrm|provider.*message/);

    expect(migration).toMatch(/revoke all on function public\.apply_feishu_directory_sync_observed\(uuid, uuid, jsonb, uuid\)\s+from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/grant execute on function public\.apply_feishu_directory_sync_observed\(uuid, uuid, jsonb, uuid\)\s+to service_role/);
    expect(migration).toMatch(/revoke all on function public\.record_feishu_directory_sync_failure\(uuid, uuid, text, uuid\)\s+from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/grant execute on function public\.record_feishu_directory_sync_failure\(uuid, uuid, text, uuid\)\s+to service_role/);
    expect(migration).toMatch(/revoke all on function public\.apply_feishu_directory_sync\(uuid, uuid, jsonb\)\s+from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/revoke insert, update, delete, truncate, references, trigger on table public\.directory_connections,\s+public\.directory_sync_runs, public\.directory_sync_issues\s+from public, anon, authenticated, service_role/);
  });
});
