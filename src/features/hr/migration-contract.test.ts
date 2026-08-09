// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202608040003_employee_directory.sql",
);

describe("employee directory migration", () => {
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8").toLowerCase()
    : "";

  it.each(["departments", "employee_profiles"])(
    "creates and protects %s",
    (table) => {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toContain(
        `alter table public.${table} force row level security`,
      );
    },
  );

  it("keeps public ids, employee numbers, and lifecycle states explicit", () => {
    expect(migration).toMatch(
      /public_id\s+uuid\s+not null\s+default gen_random_uuid\(\)\s+unique/g,
    );
    expect(migration).toContain("employee_profiles_organization_employee_no_idx");
    expect(migration).toContain(
      "check (employment_status in ('probation', 'active', 'on_leave', 'departed'))",
    );
    expect(migration).toContain(
      "check (employment_type in ('full_time', 'part_time', 'contractor', 'intern'))",
    );
  });

  it("guards every optional hierarchy link inside one organization", () => {
    expect(migration).toContain("guard_department_hierarchy");
    expect(migration).toContain("guard_employee_profile_relations");
    expect(migration).toContain("employee_profiles_department_id_idx");
    expect(migration).toContain("employee_profiles_manager_employee_id_idx");
    expect(migration).toContain("employee_profiles_organization_member_id_idx");
    expect(migration).toContain("departments_organization_status_idx");
  });

  it("allows members to read and only HR administrators to write", () => {
    expect(migration).toContain("departments_member_select");
    expect(migration).toContain("employee_profiles_member_select");
    expect(migration).toContain("departments_hr_insert");
    expect(migration).toContain("departments_hr_update");
    expect(migration).toContain("employee_profiles_hr_insert");
    expect(migration).toContain("employee_profiles_hr_update");
    expect(migration).toContain("array['owner', 'admin', 'hr']");
    expect(migration).not.toContain("employee_profiles_hr_delete");
    expect(migration).not.toContain("departments_hr_delete");
  });
});
