import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("formal task acceptance migration", () => {
  it("adds a server-owned acceptance timestamp to project tasks", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "supabase/migrations/202608190001_task_acceptance_tracking.sql"),
      "utf8",
    );

    expect(sql).toMatch(/alter table public\.tasks[\s\S]*accepted_at timestamptz/i);
  });
});
