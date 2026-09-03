// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609030001_agent_runtime_schema_repairs.sql"),
  "utf8",
).toLowerCase();

describe("Agent runtime schema repair migration", () => {
  it("keeps table-specific OLD fields behind mutually exclusive trigger branches", () => {
    expect(migration).toContain("if tg_table_name = 'agent_versions' then");
    expect(migration).toContain("elsif tg_table_name = 'agent_version_tools' then");
    expect(migration).toContain("old.agent_version_id");
    expect(migration).not.toMatch(/tg_table_name\s*=\s*'agent_versions'\s+and\s+old\.lifecycle/);
  });

  it("uses the deployed audit log column contract for Agent and scheduling idempotency", () => {
    expect(migration).toContain("audit.target_type = 'scheduling_goal'");
    expect(migration).toContain("audit.target_type = 'agent_definition'");
    expect(migration).toContain("audit.target_id = goal.public_id::text");
    expect(migration).toContain("audit.target_id = agent.public_id::text");
    expect(migration).not.toContain("audit.resource_type");
    expect(migration).not.toContain("audit.resource_id");
  });
});
