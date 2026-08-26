import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "202608260010_employee_private_profiles.sql",
);

describe("employee private profile migration contract", () => {
  it("creates the private authority and least-privilege RPC boundary", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");

    const directoryFunction = migration.match(
      /create or replace function public\.current_employee_directory\(\)[\s\S]*?\$\$;/i,
    )?.[0].toLowerCase() ?? "";
    const privateFunction = migration.match(
      /create or replace function public\.current_employee_private_profile\([\s\S]*?\$\$;/i,
    )?.[0].toLowerCase() ?? "";
    const payrollFactsFunction = migration.match(
      /create or replace function public\.current_payroll_employee_facts\([\s\S]*?\$\$;/i,
    )?.[0].toLowerCase() ?? "";
    const publicGrant = migration.match(
      /grant select \([\s\S]*?\) on table public\.employee_profiles to authenticated;/i,
    )?.[0].toLowerCase() ?? "";
    const publicWriteGrants = [
      ...migration.matchAll(
        /grant (?:insert|update) \([\s\S]*?\) on table public\.employee_profiles to authenticated;/gi,
      ),
    ].map(([grant]) => grant.toLowerCase());

    expect(migration).toContain("create table public.employee_private_profiles");
    expect(migration).toContain("create unique index if not exists employee_profiles_tenant_organization_id_uidx");
    expect(migration).toContain("alter table public.employee_private_profiles enable row level security");
    expect(migration).toContain("alter table public.employee_private_profiles force row level security");
    expect(migration).toContain("revoke all on table public.employee_private_profiles from public, anon, authenticated");
    expect(migration).toContain("revoke select (work_email, phone, hire_date, departure_date");
    expect(migration).toContain("create trigger employee_profiles_sync_private_profile");
    expect(migration).toMatch(/insert into public\.employee_private_profiles[\s\S]*?from public\.employee_profiles/i);
    expect(migration).toContain("when new.work_email is distinct from old.work_email");
    expect(migration).toContain("else employee_private_profiles.private_email");
    expect(publicGrant).toContain("display_name");
    expect(publicGrant).not.toMatch(/work_email|phone|hire_date|departure_date|salary_grade_code|job_level/);
    expect(migration).toContain("revoke insert, update on table public.employee_profiles from public, anon, authenticated");
    expect(publicWriteGrants).toHaveLength(0);

    expect(directoryFunction).toContain("security definer");
    expect(directoryFunction).toContain("set search_path = ''");
    expect(directoryFunction).toContain("current_tenant_id()");
    expect(directoryFunction).toContain("member.status = 'active'");
    expect(directoryFunction).toContain("left join public.organization_members target_member");
    expect(directoryFunction).toContain("profile.organization_member_id is null");
    expect(directoryFunction).toContain("target_member.status in ('active', 'invited')");
    expect(directoryFunction).toContain("manager.employment_status in ('probation', 'active', 'on_leave')");
    expect(directoryFunction).toMatch(
      /manager\.organization_member_id is null\s+or exists \(\s+select 1\s+from public\.organization_members manager_member[\s\S]*?manager_member\.status in \('active', 'invited'\)/,
    );
    expect(directoryFunction).not.toMatch(/employee_private_profiles|phone|work_email|hire_date|departure_date|sensitive_hr_notes|salary_grade_code|job_level/);

    expect(privateFunction).toContain("security definer");
    expect(privateFunction).toContain("set search_path = ''");
    expect(privateFunction).toContain("profile.public_id = p_employee_public_id");
    expect(privateFunction).toContain("private.tenant_id = profile.tenant_id");
    expect(privateFunction).toContain("private.organization_id = profile.organization_id");
    expect(privateFunction).toContain("target_member.user_id = (select auth.uid())");
    expect(privateFunction).toContain("target_member.status = 'active'");
    expect(privateFunction).toContain("has_organization_permission(profile.organization_id, 'hr.manage')");
    expect(privateFunction).toContain("array['owner', 'admin']");
    expect(privateFunction).not.toContain("array['owner', 'admin', 'hr']");
    expect(payrollFactsFunction).toContain("returns table (");
    expect(payrollFactsFunction).toContain("profile_id bigint");
    expect(payrollFactsFunction).toContain("organization_member_id bigint");
    expect(payrollFactsFunction).toContain("hire_date date");
    expect(payrollFactsFunction).toContain("security definer");
    expect(payrollFactsFunction).toContain("set search_path = ''");
    expect(payrollFactsFunction).toContain("current_tenant_id()");
    expect(payrollFactsFunction).toContain("actor.user_id = (select auth.uid())");
    expect(payrollFactsFunction).toContain("actor.status = 'active'");
    expect(payrollFactsFunction).toContain("profile.organization_member_id = p_employee_member_id");
    expect(payrollFactsFunction).not.toContain("target_member.status = 'active'");
    expect(payrollFactsFunction).not.toContain("profile.employment_status in ('probation', 'active', 'on_leave')");
    expect(payrollFactsFunction).toContain("has_organization_permission(actor.organization_id, 'salary.manage')");
    expect(payrollFactsFunction).not.toContain("private_email");
    expect(payrollFactsFunction).not.toContain("phone");
    expect(payrollFactsFunction).not.toContain("sensitive_hr_notes");
    expect(migration).toContain("grant execute on function public.current_employee_directory() to authenticated");
    expect(migration).toContain("grant execute on function public.current_employee_private_profile(uuid) to authenticated");
    expect(migration).toContain("revoke all on function public.current_payroll_employee_facts(bigint) from public, anon, authenticated, service_role");
    expect(migration).toContain("grant execute on function public.current_payroll_employee_facts(bigint) to authenticated");
    expect(migration).toContain("revoke all on table public.employee_private_profiles from public, anon, authenticated, service_role");
    expect(migration).toContain("revoke all on sequence public.employee_private_profiles_id_seq from public, anon, authenticated, service_role");
    for (const functionName of [
      "touch_employee_private_profiles_updated_at()",
      "sync_employee_profile_private_legacy_fields()",
      "current_employee_directory()",
      "current_employee_private_profile(uuid)",
      "current_payroll_employee_facts(bigint)",
    ]) {
      expect(migration).toContain(`revoke all on function public.${functionName} from public, anon, authenticated, service_role`);
    }
  });
});
