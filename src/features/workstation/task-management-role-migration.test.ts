import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("task management role alignment migration", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/202608210003_task_management_role_alignment.sql"),
    "utf8",
  );

  it("removes task management from the ordinary employee role only", () => {
    expect(sql).toMatch(/delete\s+from\s+public\.role_permissions/i);
    expect(sql).toMatch(/role\.code\s*=\s*'employee'/i);
    expect(sql).toMatch(/permission\.code\s*=\s*'task\.manage'/i);
    expect(sql).not.toMatch(/role\.code\s*=\s*'owner'/i);
    expect(sql).not.toMatch(/role\.code\s*=\s*'admin'/i);
    expect(sql).not.toMatch(/role\.code\s*=\s*'department_head'/i);
  });
});
