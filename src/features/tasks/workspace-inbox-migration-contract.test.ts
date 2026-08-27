import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/202608270010_exact_workspace_approval_scope.sql"),
  "utf8",
);

describe("workspace approval inbox migration", () => {
  it("selects only the current pending step for the authenticated employee", () => {
    expect(migration).toContain("current_actionable_approval_inbox");
    expect(migration).toContain("distinct on (step.approval_id)");
    expect(migration).toContain("order by step.approval_id, step.step_order");
    expect(migration).toContain("step.approver_employee_id = viewer.employee_id");
    expect(migration).toContain("count(*) over ()::bigint as total_count");
  });

  it("keeps tenant identity and public ID boundaries inside the security definer", () => {
    expect(migration).toContain("identity.tenant_id = (select public.current_tenant_id())");
    expect(migration).toContain("identity.organization_id");
    expect(migration).toContain("identity.organization_member_id");
    expect(migration).toContain("identity.auth_user_id = (select auth.uid())");
    expect(migration).toContain("identity.status = 'active'");
    expect(migration).toContain("provider.status = 'active'");
    expect(migration).toContain("member.user_id = (select auth.uid())");
    expect(migration.match(/profile\.employment_status in \('probation', 'active', 'on_leave'\)/g)).toHaveLength(3);
    expect(migration).toContain("returns table (\n  public_id uuid");
    expect(migration).not.toContain("returns table (\n  id bigint");
    expect(migration).toContain("revoke all on function public.current_actionable_approval_inbox() from public, anon");
    expect(migration).toContain("grant execute on function public.current_actionable_approval_inbox() to authenticated");
  });

  it("replaces participant RLS resolution with the exact external workspace identity", () => {
    expect(migration).toContain("create or replace function public.is_approval_participant");
    expect(migration).toContain("approval.organization_id = viewer.organization_id");
    expect(migration).toContain("step.organization_id = viewer.organization_id");
    expect(migration).not.toMatch(/from public\.organization_members member[\s\S]{0,400}order by member\.id[\s\S]{0,40}limit 1/i);
  });

  it("restores only the viewer's submitted daily report with a public project ID", () => {
    expect(migration).toContain("current_submitted_daily_report(p_report_date date)");
    expect(migration).toContain("project.public_id as project_id");
    expect(migration).toContain("report.author_member_id = viewer.member_id");
    expect(migration).toContain("report.status = 'submitted'");
    expect(migration).toContain("membership.left_at is null");
    expect(migration).toContain("revoke all on function public.current_submitted_daily_report(date) from public, anon");
  });
});
