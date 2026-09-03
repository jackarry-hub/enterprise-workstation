import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("knowledge processing transition migration", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/202609030005_knowledge_processing_transition.sql"),
    "utf8",
  ).toLowerCase();

  it("keeps published content immutable outside an active processing transition", () => {
    expect(sql).toContain("app.knowledge_processing_transition_id");
    expect(sql).toContain("job.state = 'running'");
    expect(sql).toContain("job.lease_expires_at >= clock_timestamp()");
    expect(sql).toContain("new.title is not distinct from old.title");
    expect(sql).toContain("new.summary is not distinct from old.summary");
    expect(sql).toContain("new.status is not distinct from old.status");
    expect(sql).toContain("published knowledge versions are immutable");
  });

  it("opens and clears the transition only inside the service completion function", () => {
    expect(sql).toContain("set_config('app.knowledge_processing_transition_id',v_job.public_id::text,true)");
    expect(sql.match(/set_config\('app\.knowledge_processing_transition_id','',true\)/g)).toHaveLength(3);
    expect(sql).toContain("grant execute on function public.complete_knowledge_processing_job(uuid,uuid,boolean,jsonb,text) to service_role");
  });
});
