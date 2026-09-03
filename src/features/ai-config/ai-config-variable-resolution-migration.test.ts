import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("AI configuration command variable resolution migration", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/202609030002_ai_config_command_variable_resolution.sql"),
    "utf8",
  ).toLowerCase();

  it("recompiles the command with parameters preferred over same-named columns", () => {
    expect(sql).toContain("create or replace function public.update_current_ai_provider_config(");
    expect(sql).toContain("#variable_conflict use_variable");
    expect(sql).toContain("audit.request_id = request_id");
    expect(sql).toContain("on conflict on constraint ai_provider_configs_pkey do update");
  });

  it("does not roll the shared audit action constraint back to an older catalog", () => {
    expect(sql).not.toContain("audit_logs_action_check");
    expect(sql).not.toContain("create unique index audit_logs_ai_config_request_id_uidx");
  });
});
