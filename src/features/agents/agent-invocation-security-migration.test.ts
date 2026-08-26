// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608260005_agent_invocation_security.sql");

describe("Agent invocation append-only migration", () => {
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8").toLowerCase() : "";

  it("removes authenticated mutation privileges and old direct-write policies", () => {
    expect(migration).toContain("revoke insert, update, delete on table public.agent_invocations from authenticated");
    expect(migration).toContain("revoke insert, update, delete on table public.agent_execution_logs from authenticated");
    expect(migration).toContain("drop policy if exists agent_invocations_member_insert");
    expect(migration).toContain("drop policy if exists agent_invocations_system_update");
    expect(migration).toContain("drop policy if exists agent_execution_logs_member_insert");
  });

  it("keeps server-only append capability and adds a real system prompt column", () => {
    expect(migration).toContain("add column if not exists system_prompt text not null default ''");
    expect(migration).toContain("grant insert on table public.agent_invocations, public.agent_execution_logs to service_role");
    expect(migration).toContain("revoke usage, select on sequence public.agent_invocations_id_seq, public.agent_execution_logs_id_seq from authenticated");
  });
});
