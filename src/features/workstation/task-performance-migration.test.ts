import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("task performance evidence migration", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/202608210002_task_performance_evidence.sql"),
    "utf8",
  ).toLowerCase();

  it("counts submissions and rejected or reopened work from status transitions", () => {
    expect(sql).toMatch(/old\.status = 'in_progress' and new\.status = 'in_review'[\s\S]*submission_count := old\.submission_count \+ 1/);
    expect(sql).toMatch(/old\.status = 'in_review' and new\.status = 'in_progress'[\s\S]*rejection_count := old\.rejection_count \+ 1/);
    expect(sql).toMatch(/old\.status = 'done' and new\.status = 'in_progress'/);
  });

  it("does not couple execution evidence to salary or compensation", () => {
    expect(sql).not.toMatch(/salary|payroll|bonus|compensation/);
  });
});
