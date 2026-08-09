// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202608040004_attendance.sql",
);

describe("attendance migration", () => {
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8").toLowerCase()
    : "";

  it("creates the stable attendance core table with soft-delete lifecycle", () => {
    expect(migration).toContain("create table public.attendance");
    expect(migration).toContain("public_id uuid not null default gen_random_uuid() unique");
    expect(migration).toContain("employee_profile_id bigint not null references public.employee_profiles(id)");
    expect(migration).toContain("attendance_date date not null");
    expect(migration).toContain("deleted_at timestamptz");
  });

  it("keeps attendance status, source, and minute counters explicit", () => {
    expect(migration).toContain(
      "check (status in ('normal', 'late', 'early_leave', 'leave'))",
    );
    expect(migration).toContain(
      "check (source in ('manual', 'import', 'device'))",
    );
    expect(migration).toContain("late_minutes integer not null default 0");
    expect(migration).toContain("early_leave_minutes integer not null default 0");
  });

  it("prevents duplicate active daily records and guards organization ownership", () => {
    expect(migration).toContain("attendance_organization_employee_date_idx");
    expect(migration).toContain("guard_attendance_employee_organization");
    expect(migration).toContain("attendance_organization_date_status_idx");
    expect(migration).toContain("attendance_employee_date_idx");
  });

  it("enables row-level security with read and managed-write boundaries", () => {
    expect(migration).toContain("alter table public.attendance enable row level security");
    expect(migration).toContain("alter table public.attendance force row level security");
    expect(migration).toContain("attendance_member_select");
    expect(migration).toContain("attendance_manager_insert");
    expect(migration).toContain("attendance_manager_update");
    expect(migration).toContain("array['owner', 'admin', 'hr']");
    expect(migration).not.toContain("attendance_manager_delete");
  });
});
