import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("employee work profile migration", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/202608210001_employee_work_profiles.sql"),
    "utf8",
  ).toLowerCase();

  it("limits employee updates to the signed-in employee profile", () => {
    const updatePolicy = sql.match(
      /create policy employee_work_profiles_self_update[\s\S]*?;\s*\n\s*grant/i,
    )?.[0] ?? "";

    expect(updatePolicy).toContain("member.user_id = (select auth.uid())");
    expect(updatePolicy.match(/member\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(2);
    expect(updatePolicy).toContain("profile.id = employee_work_profiles.employee_profile_id");
  });

  it("stores only professional collaboration fields and no compensation data", () => {
    expect(sql).toContain("preferred_task_types");
    expect(sql).toContain("weekly_capacity_hours");
    expect(sql).toContain("self_skills");
    expect(sql).not.toMatch(/salary|payroll|bonus|tax/);
  });
});
