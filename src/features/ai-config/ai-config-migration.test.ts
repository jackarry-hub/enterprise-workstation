import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("AI provider configuration migration", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/202608170001_ai_provider_configs.sql"),
    "utf8",
  ).toLowerCase();

  it("creates a tenant/provider primary key and enables RLS", () => {
    expect(sql).toContain("primary key (tenant_id, provider)");
    expect(sql).toContain("enable row level security");
  });

  it("does not grant browser roles direct access", () => {
    expect(sql).toContain("revoke all on public.ai_provider_configs from anon");
    expect(sql).toContain(
      "revoke all on public.ai_provider_configs from authenticated",
    );
    expect(sql).not.toContain("create policy");
  });
});
