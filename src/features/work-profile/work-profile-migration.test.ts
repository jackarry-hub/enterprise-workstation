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

describe("employee work profile command hardening", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/202608260012_skill_verification_commands.sql"),
    "utf8",
  ).toLowerCase();

  it("moves writes to an authenticated current-profile command", () => {
    const command = sql.match(
      /create or replace function public\.update_current_employee_work_profile\([\s\S]*?\$\$;/i,
    )?.[0] ?? "";

    expect(sql).toContain("revoke insert, update on table public.employee_work_profiles from authenticated");
    expect(command).toContain("security definer");
    expect(command).toContain("set search_path = ''");
    expect(command).toContain("external.auth_user_id = (select auth.uid())");
    expect(command).toContain("member.status = 'active'");
    expect(command).toContain("profile.organization_member_id = member.id");
    expect(command).not.toMatch(/p_tenant|p_organization|p_member|p_profile/);
  });

  it("keeps verification evidence out of direct authenticated access", () => {
    expect(sql).toContain("revoke insert, update on table public.employee_skills from authenticated");
    expect(sql).toContain("grant update (proficiency_level, years_experience)");
    expect(sql).toContain("revoke select on table public.employee_skills from authenticated");
    expect(sql).toContain("verification_reason is null or length(btrim(verification_reason))");
    expect(sql).toContain("decision is distinct from 'verified'");
    expect(sql).toContain("return jsonb_build_object('outcome', 'failure', 'error', 'not_found')");
  });
});
