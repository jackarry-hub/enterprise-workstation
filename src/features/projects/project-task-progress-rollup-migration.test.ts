import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202609030004_project_task_progress_rollup.sql",
), "utf8");

describe("project task progress rollup migration", () => {
  it("recalculates progress from completed non-cancelled tasks", () => {
    expect(sql).toContain("count(*) filter (where task.status = 'done')");
    expect(sql).toContain("count(*) filter (where task.status <> 'cancelled')");
    expect(sql).toContain("and task.deleted_at is null");
  });

  it("runs after task lifecycle changes and backfills existing projects", () => {
    expect(sql).toContain("after insert or delete or update of status, deleted_at");
    expect(sql).toContain("with progress_rollup as");
    expect(sql).toContain("and project.progress is distinct from rollup.progress");
  });

  it("keeps the trigger helper private", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke all on function public.roll_up_project_progress_from_tasks()");
  });
});
