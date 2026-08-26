// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608260006_agent_invocation_append_only.sql");

describe("Agent invocation append-only migration", () => {
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8").toLowerCase() : "";

  it("removes authenticated mutation privileges and old direct-write policies", () => {
    expect(migration).toContain("revoke insert, update, delete, truncate on table public.agent_definitions, public.agent_permissions from authenticated");
    expect(migration).toContain("revoke all on table public.agent_invocations, public.agent_execution_logs from service_role");
    expect(migration).toContain("revoke select on table public.agent_definitions from authenticated");
  });

  it("keeps server-only append capability and adds a real system prompt column", () => {
    expect(migration).toContain("update public.agent_definitions");
    expect(migration).toContain("set status = 'disabled'");
    expect(migration).toContain("grant select (id, public_id, tenant_id, organization_id, code, name, description, department_id, icon, model_code, prompt_version, capabilities, input_schema, tool_scope, visibility_scope, min_job_level, status, created_at, updated_at, deleted_at) on table public.agent_definitions to authenticated");
    expect(migration).toContain("grant select, insert on table public.agent_invocations, public.agent_execution_logs to service_role");
    expect(migration).toContain("create trigger agent_invocations_append_only");
    expect(migration).toContain("terminal rows require completed_at");
    expect(migration).toContain("revoke all on sequence public.agent_invocations_id_seq, public.agent_execution_logs_id_seq from service_role");
  });

  it("uses one total execution-ready validator for disabling and constraining definitions", () => {
    expect(migration).toContain("create or replace function public.is_agent_execution_ready");
    expect(migration).toContain("language plpgsql");
    expect(migration).toContain("exception when others then");
    expect(migration).toContain("not public.is_agent_execution_ready(model_code, prompt_version, system_prompt, tool_scope)");
    expect(migration).toContain("public.is_agent_execution_ready(model_code, prompt_version, system_prompt, tool_scope)");
  });

  it("backfills terminal timing from the historical creation point without a future completion", () => {
    expect(migration).toContain("completed_at = created_at");
    expect(migration).toContain("started_at = created_at - (coalesce(latency_ms, 0) * interval '1 millisecond')");
  });
});
