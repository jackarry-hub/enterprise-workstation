// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608260008_agent_invocation_lifecycle.sql");

describe("Agent invocation lifecycle migration", () => {
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8").toLowerCase() : "";

  it("persists immutable tool scope and permits terminal changes only through a locked service RPC", () => {
    expect(migration).toContain("add column if not exists tool_scope jsonb not null default '{\"tools\":[]}'::jsonb");
    expect(migration).toContain("create or replace function public.finalize_agent_invocation");
    expect(migration).toContain("for update");
    expect(migration).toContain("set_config('app.agent_invocation_transition_id'");
    expect(migration).toContain("member.id = new.actor_member_id");
    expect(migration).toContain("grant execute on function public.finalize_agent_invocation");
    expect(migration).toContain("revoke all on function public.finalize_agent_invocation(bigint, bigint, uuid, text, text, integer, integer, integer, text, timestamptz) from public, anon, authenticated");
  });

  it("adds bounded tenant-scoped stale-running recovery without direct table updates", () => {
    expect(migration).toContain("create or replace function public.recover_stale_agent_invocations");
    expect(migration).toContain("where candidate.tenant_id = p_tenant_id");
    expect(migration).toContain("and candidate.status in ('queued', 'running')");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("p_limit not between 1 and 100");
    expect(migration).toContain("interval '5 minutes'");
  });
});
