import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Agent starter pack migration", () => {
  it("provisions published immutable versions without pretending to execute business writes", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202609020001_agent_starter_pack.sql"), "utf8").toLowerCase();
    expect(sql).toContain("provision_current_agent_starter_pack");
    expect(sql).toContain("'task_breakdown'");
    expect(sql).toContain("'smart_dispatch'");
    expect(sql).toContain("'project_review'");
    expect(sql).toContain("set lifecycle = 'published'");
    expect(sql).toContain("'agent.starter_pack.provisioned'");
    expect(sql).toContain("不得声称已创建、修改或分配任何业务记录");
    expect(sql).toContain("'tools', jsonb_build_array()");
  });
});
