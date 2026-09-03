import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("AI provider configuration service access migration", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/202609030001_ai_provider_config_service_read.sql"),
    "utf8",
  ).toLowerCase();

  it("allows server-side reads without exposing the table to browser roles", () => {
    expect(sql).toContain("revoke all on table public.ai_provider_configs from service_role");
    expect(sql).toContain("grant select on table public.ai_provider_configs to service_role");
    expect(sql).toContain("revoke all on table public.ai_provider_configs from anon, authenticated");
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|truncate)/);
  });
});
