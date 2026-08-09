// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202608040002_project_collaboration_extensions.sql",
);

describe("project collaboration extension migration", () => {
  const migration = readFileSync(migrationPath, "utf8").toLowerCase();

  it.each(["project_activities", "project_risks", "file_relations"])(
    "creates and protects %s",
    (table) => {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`alter table public.${table} force row level security`);
    },
  );

  it("keeps activities append-only and tenant scoped", () => {
    expect(migration).toContain("project_activities_project_same_organization_fk");
    expect(migration).toContain("project_activities_user_id_fkey");
    expect(migration).toContain("project_activities_select");
    expect(migration).toContain("project_activities_action_type_check");
    expect(migration).not.toContain("create policy project_activities_insert");
    expect(migration).not.toContain("project_activities_update");
    expect(migration).not.toContain("project_activities_delete");
    expect(migration).toContain("grant select, insert on public.project_activities to service_role");
  });

  it("enforces typed risk ownership and indexed project queries", () => {
    expect(migration).toContain("project_risks_owner_same_organization_fk");
    expect(migration).toContain("ensure_project_risk_owner_is_active");
    expect(migration).toContain("project_risks_active_owner");
    expect(migration).toContain("project_members_guard_risk_ownership");
    expect(migration).toContain("organization_members_guard_risk_ownership");
    expect(migration).toContain("project_risks_project_status_deadline_idx");
    expect(migration).toContain("check (level in ('low', 'medium', 'high', 'critical'))");
    expect(migration).toContain("check (status in ('open', 'monitoring', 'mitigated', 'closed'))");
  });

  it("uses concrete same-project foreign keys for polymorphic file relations", () => {
    expect(migration).toContain("file_relations_file_same_organization_fk");
    expect(migration).toContain("file_relations_task_same_project_fk");
    expect(migration).toContain("file_relations_milestone_same_project_fk");
    expect(migration).toContain("file_relations_daily_report_same_project_fk");
    expect(migration).toContain("file_relations_comment_same_project_fk");
    expect(migration).toContain("file_relations_target_check");
    expect(migration).toContain("file_relations_organization_file_id_idx");
    expect(migration).toMatch(
      /created_by_member_id\s*=\s*public\.current_organization_member_id\(organization_id\)\s*\n\s*and public\.can_contribute_project\(project_id\)/,
    );
  });
});
