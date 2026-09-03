// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Agent authorization service-role projection migration", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/202609030003_agent_authorization_service_read.sql"),
    "utf8",
  ).toLowerCase();

  it("grants only the columns read by the server authorization path", () => {
    for (const table of [
      "tenants", "organizations", "organization_members", "employee_profiles",
      "departments", "member_roles", "roles", "agent_definitions",
      "agent_runtime_controls", "agent_versions", "agent_runtime_tool_allowlists",
      "agent_runtime_data_allowlists", "agent_permissions",
    ]) {
      expect(sql).toMatch(new RegExp(`grant\\s+select\\s*\\([\\s\\S]*?\\)\\s+on table public\\.${table} to service_role`));
      expect(sql).not.toContain(`grant select on table public.${table} to service_role`);
    }
  });

  it("does not grant writes or change browser-role access", () => {
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|truncate|references|trigger)/);
    expect(sql).not.toMatch(/\b(anon|authenticated)\b/);
    expect(sql).not.toContain("employee_private_profiles");
  });
});
