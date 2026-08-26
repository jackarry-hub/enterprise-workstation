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
    expect(observed).toContain("security definer");
    expect(observed).toContain("set search_path = ''");
    expect(observed).toContain("p_request_id uuid");
    expect(observed).toContain("role.code in ('owner', 'admin')");
    expect(observed).toContain("hashtextextended('directory-sync:' || v_tenant_id::text, 0)");
    expect(observed).toContain("max(run.id)");
    expect(observed).toContain("public.apply_feishu_directory_sync(");
    expect(observed).toContain("run.id > v_before_run_id");
    expect(observed).toContain("run.request_id = p_request_id");
    expect(observed).not.toContain("order by run.id desc limit 1");

    expect(failure).toContain("security definer");
    expect(failure).toContain("set search_path = ''");
    expect(failure).toContain("p_request_id uuid");
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
    expect(migration).toMatch(/revoke insert, update, delete on table public\.directory_connections,\s+public\.directory_sync_runs, public\.directory_sync_issues\s+from public, anon, authenticated, service_role/);
  });
});
