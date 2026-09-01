// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202608260009_agent_invocation_recovery_scheduler.sql",
);
const recoveryFixMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202609010002_fix_agent_recovery_tenant_iteration.sql",
);

describe("Agent invocation recovery scheduler migration", () => {
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8").toLowerCase() : "";
  const recoveryFixMigration = existsSync(recoveryFixMigrationPath)
    ? readFileSync(recoveryFixMigrationPath, "utf8").toLowerCase()
    : "";

  it("rejects null limits and clamps elapsed recovery duration before narrowing to integer", () => {
    expect(migration).toContain("p_limit is null");
    expect(migration).toContain("least(2147483647::bigint");
    expect(migration).toContain("floor(extract(epoch from (completed_at_value - invocation.started_at)) * 1000)::bigint");
    expect(migration).not.toContain("floor(extract(epoch from (completed_at_value - invocation.started_at)) * 1000)::integer");
  });

  it("adds a service-only, advisory-locked all-tenant recovery worker without caller scope", () => {
    expect(migration).toContain("create or replace function public.run_agent_invocation_recovery()");
    expect(migration).toContain("pg_try_advisory_xact_lock");
    expect(migration).toContain("from public.tenants tenant");
    expect(migration).toContain("tenant.status = 'active'");
    expect(migration).toContain("recover_stale_agent_invocations(tenant.id");
    expect(migration).toContain("revoke all on function public.run_agent_invocation_recovery() from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.run_agent_invocation_recovery() to service_role");
  });

  it("uses a scalar tenant id in the forward fix so PL/pgSQL cannot read an unassigned record", () => {
    expect(recoveryFixMigration).toContain("current_tenant_id bigint");
    expect(recoveryFixMigration).toContain("for current_tenant_id in");
    expect(recoveryFixMigration).toContain("from public.tenants as t");
    expect(recoveryFixMigration).toContain("recover_stale_agent_invocations(\n      current_tenant_id");
    expect(recoveryFixMigration).not.toContain("for tenant in");
    expect(recoveryFixMigration).toContain("grant execute on function public.run_agent_invocation_recovery() to service_role");
  });
});
