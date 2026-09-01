import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/202609010001_employee_operating_model.sql"),
  "utf8",
).toLowerCase();

describe("employee operating model migration", () => {
  it("adds versioned SOPs, real runs, decisions and retrospectives", () => {
    for (const table of [
      "project_sop_definitions", "project_sop_versions", "project_sop_runs",
      "project_sop_run_events", "project_decisions", "project_retrospectives",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
    expect(sql).toContain("public.valid_project_sop_steps");
    expect(sql).toContain("public.valid_project_decision_citations");
    expect(sql).toContain("v_type='link' and v_id !~ '^https://");
    expect(sql).toContain("project_sop_versions_published_immutable");
    expect(sql).toContain("project_sop_run_events_append_only");
  });

  it("uses existing project permissions, idempotency and durable audit", () => {
    for (const command of [
      "save_current_project_sop", "start_current_project_sop_run", "advance_current_project_sop_run",
      "record_current_project_decision", "transition_current_project_decision",
      "save_current_project_retrospective", "update_current_project_risk_status",
    ]) {
      expect(sql).toContain(`create or replace function public.${command}`);
      expect(sql).toContain(`public.claim_project_execution_command`);
      expect(sql).toContain(`grant execute on function public.${command}`);
    }
    expect(sql).toContain("public.lock_current_project_execution_access");
    expect(sql).toContain("public.complete_project_execution_command");
    expect(sql).toContain("public.can_manage_project");
  });

  it("exposes safe read projections and closes browser writes", () => {
    expect(sql).toContain("create or replace function public.current_project_operating_model");
    expect(sql).toContain("create or replace function public.current_employee_capability_center");
    expect(sql).toMatch(/revoke insert,update,delete,truncate,references,trigger on public\.project_sop_definitions,[\s\S]*?from public,anon,authenticated,service_role/);
    expect(sql).toContain("v_target.manager_employee_id=v_actor_profile.id");
    expect(sql).toContain("v_target.organization_member_id=v_actor.member_id or public.has_organization_permission(v_org,'agent.manage')");
  });

  it("moves the staging gate to this migration", () => {
    expect(sql).toContain("v_marker constant text := '202609010001'");
    expect(sql).toContain("to_regclass('public.project_sop_run_events') is not null");
  });
});
