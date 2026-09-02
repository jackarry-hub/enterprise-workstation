import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("external workflow runtime migration", () => {
  it("keeps run evidence scoped, append-only and service-owned", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202609020004_external_workflow_runtime.sql"), "utf8").toLowerCase();
    for (const marker of [
      "force row level security",
      "external_workflow_runs_append_only",
      "start_external_workflow_run",
      "finalize_external_workflow_run",
      "to service_role",
      "agent_runtime_controls",
      "append_audit_log",
    ]) expect(sql).toContain(marker);
    expect(sql).not.toContain("grant insert on public.agent_external_workflow_runs to authenticated");
    expect(sql).not.toContain("grant update on public.agent_external_workflow_runs to authenticated");
  });
});
