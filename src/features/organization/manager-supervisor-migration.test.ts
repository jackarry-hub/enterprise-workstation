import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202608270003_manager_supervisor_scope.sql",
);
const source = () => existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const sql = () => source().toLowerCase();
const pgTap = () => readFileSync(
  path.join(process.cwd(), "supabase/tests/organization_commands.sql"),
  "utf8",
).toLowerCase();

function functionBlock(name: string) {
  const migration = sql();
  const start = migration.indexOf(`function public.${name}(`);
  if (start < 0) return "";
  const end = migration.indexOf("$$;", start);
  return end < 0 ? migration.slice(start) : migration.slice(start, end + 3);
}

describe("manager and supervisor forward migration", () => {
  it("is the sole forward migration and strengthens the existing manager relation", () => {
    const migration = sql();

    expect(migrationPath).toMatch(/202608270003_manager_supervisor_scope\.sql$/);
    expect(migration).toContain("drop constraint if exists employee_profiles_manager_employee_id_fkey");
    expect(migration).toContain("drop constraint if exists employee_profiles_tenant_manager_fkey");
    expect(migration).toMatch(/foreign key \(tenant_id, organization_id, manager_employee_id\)[\s\S]*references public\.employee_profiles \(tenant_id, organization_id, id\)/);
    expect(migration).toContain("manager_version bigint not null default 1");
    expect(migration).toContain("manager_source text not null default 'unassigned'");
    expect(migration).not.toContain("add column manager_employee_id");
    expect(source()).not.toMatch(/^\+/m);
  });

  it("guards manager state, active exact-organization managers, manual department scope, and cycles", () => {
    const guard = functionBlock("guard_employee_profile_relations");

    expect(guard).toContain("manager.tenant_id = new.tenant_id");
    expect(guard).toContain("manager.organization_id = new.organization_id");
    expect(guard).toContain("manager.deleted_at is null");
    expect(guard).toContain("manager.employment_status in ('probation', 'active', 'on_leave')");
    expect(guard).toContain("manager_member.status = 'active'");
    expect(guard).toContain("new.manager_source = 'manual'");
    expect(guard).toContain("v_manager_department_id is distinct from new.department_id");
    expect(guard).toContain("with recursive reporting_chain");
    expect(guard).toContain("raise exception 'manager_cycle'");

    const authorizationMutation = guard.replaceAll(
      "manager.organization_id = new.organization_id",
      "manager.organization_id is not null",
    );
    expect(authorizationMutation).not.toBe(guard);
    expect(authorizationMutation).not.toContain("manager.organization_id = new.organization_id");
  });

  it("creates a distinct future-safe supervisor role and narrowly scoped permission", () => {
    const migration = sql();
    const canonical = functionBlock("is_canonical_workspace_role_code");
    const provision = functionBlock("ensure_supervisor_role_for_tenant");

    expect(canonical).toMatch(/'owner'[\s\S]*'supervisor'[\s\S]*'employee'/);
    expect(provision).toContain("'supervisor', '主管'");
    expect(provision).toContain("'employee.supervisor.read'");
    expect(provision).toContain("delete from public.role_permissions");
    expect(provision).toContain("not (permission.code = any (array[");
    expect(migration).toContain("create trigger tenants_supervisor_role_provision");
    expect(migration).toContain("after insert on public.tenants");
    expect(migration).not.toMatch(/supervisor[^\n]+organization\.manage/);
    expect(migration).not.toMatch(/supervisor[^\n]+role\.manage/);
  });

  it("issues exact supervisor target public IDs in the current workspace response", () => {
    const access = functionBlock("current_workspace_access");

    expect(access).toContain("'supervisorscopeemployeeids'");
    expect(access).toContain("scope_target.manager_employee_id = profile.id");
    expect(access).toContain("scope_role.code = 'supervisor'");
    expect(access).toContain("scope_target.department_id = profile.department_id");
    expect(access).toContain("scope_role.code = 'department_head'");
    expect(access).toContain("scope_target.organization_id = member.organization_id");
    expect(access).toContain("scope_role.is_enabled");
    expect(access).toContain("scope_role.is_system");
    expect(access).toContain("scope_role.organization_id is null");
  });

  it("enforces the protected read in the database instead of trusting the session hint", () => {
    const projection = functionBlock("current_supervisor_employee_projection");
    const enforcesBoundary = (block: string) => block.includes("external.auth_user_id = (select auth.uid())")
      && block.includes("external.status = 'active'")
      && block.includes("actor.status = 'active'")
      && block.includes("target.organization_id = actor.organization_id")
      && block.includes("scope_role.code = 'supervisor'")
      && block.includes("target.manager_employee_id = actor_profile.id")
      && block.includes("scope_role.code = 'department_head'")
      && block.includes("target.department_id = actor_profile.department_id");

    expect(enforcesBoundary(projection)).toBe(true);
    const missingIdentityMutation = projection.replace(
      "external.auth_user_id = (select auth.uid())",
      "external.auth_user_id is not null",
    );
    expect(missingIdentityMutation).not.toBe(projection);
    expect(enforcesBoundary(missingIdentityMutation)).toBe(false);
    expect(sql()).toMatch(/grant execute on function public\.current_supervisor_employee_projection\(uuid\) to authenticated/);
    expect(sql()).toMatch(/revoke all on function public\.current_supervisor_employee_projection\(uuid\)\s+from public, anon, authenticated, service_role/);
  });

  it("makes manager assignment versioned, idempotent, audited, and directory-authority safe", () => {
    const command = functionBlock("assign_current_member_manager");
    const enforcesManagerBoundary = (block: string) => block.includes("current_organization_command_context('organization.manage')")
      && block.includes("v_target.manager_version <> p_expected_manager_version")
      && block.includes("v_target.manager_source = 'directory'")
      && block.includes("v_manager.department_id is distinct from v_target.department_id")
      && block.includes("select 1 from reporting_chain where id = v_target.id");
    const completesAudit = (block: string) => block.includes("'assign_current_member_manager'")
      && block.includes("'organization.manager_assigned'")
      && block.includes("public.complete_organization_command")
      && block.includes("v_before")
      && block.includes("v_after")
      && block.includes("btrim(p_reason)")
      && block.includes("idempotency_key");

    expect(enforcesManagerBoundary(command)).toBe(true);
    expect(command).toContain("request_id = idempotency_key");
    expect(command).toContain("pg_advisory_xact_lock");
    expect(command).toContain("order by profile.id for update");
    expect(command).toContain("v_target.manager_version <> p_expected_manager_version");
    expect(command).toContain("v_target.manager_source = 'directory'");
    expect(command).toContain("'directory_manager_owned'");
    expect(command).toContain("'manager_cycle'");
    expect(command).toContain("manager_version = manager_version + 1");
    expect(enforcesManagerBoundary(command.replace(
      "v_target.manager_source = 'directory'",
      "v_target.manager_source = 'manual'",
    ))).toBe(false);
    expect(enforcesManagerBoundary(command.replace(
      "v_target.manager_version <> p_expected_manager_version",
      "v_target.manager_version > 0",
    ))).toBe(false);
    expect(completesAudit(command)).toBe(true);
    expect(completesAudit(command.replaceAll("'organization.manager_assigned'", "'organization.command_failed'"))).toBe(false);
  });

  it("maps Feishu department leaders transactionally through exact connection-owned links", () => {
    const mapping = functionBlock("apply_directory_manager_hierarchy");
    const migration = sql();
    const enforcesDirectoryBoundary = (block: string) => block.includes("link.connection_id = p_connection_id")
      && block.includes("link.organization_id = p_organization_id")
      && block.includes("manager_link.connection_id = p_connection_id")
      && block.includes("manager_profile.organization_id = v_target.organization_id");

    expect(enforcesDirectoryBoundary(mapping)).toBe(true);
    expect(mapping).toContain("department.leader_member_id");
    expect(mapping).toContain("manager_profile.organization_id = v_target.organization_id");
    expect(mapping).toContain("manager_source = 'directory'");
    expect(mapping).toContain("'reconciliation_difference'");
    expect(mapping).toContain("'directory.manager_mapped'");
    expect(enforcesDirectoryBoundary(mapping.replaceAll(
      "manager_link.connection_id = p_connection_id",
      "manager_link.connection_id is not null",
    ))).toBe(false);
    expect(migration).toContain("after update of status on public.directory_sync_runs");
    expect(migration).toContain("old.status = 'running' and new.status = 'completed'");
  });

  it("keeps browser writes revoked and expands role assignment only to the canonical supervisor", () => {
    const migration = sql();
    const roleCommand = functionBlock("assign_current_member_role");

    expect(migration).toContain("revoke update (manager_employee_id, manager_source, manager_version)");
    expect(roleCommand).toContain("'supervisor'");
    expect(roleCommand).toContain("role.is_system");
    expect(roleCommand).toContain("role.organization_id is null");
    expect(roleCommand).toContain("role.is_enabled");
  });

  it("anchors live pgTAP behavior for supervisor scope, manager commands, and Feishu authority", () => {
    const tests = pgTap();

    for (const proof of [
      "supervisor workspace scope contains the exact active direct report",
      "supervisor protected projection hides an active peer outside direct-report scope",
      "department head projection includes the exact active department",
      "cross-organization protected projection returns no row",
      "manager assignment rejects a forbidden cross-department manager",
      "manager assignment rejects a direct reporting cycle",
      "manager assignment rejects a transitive reporting cycle",
      "manager assignment replay does not duplicate its audit",
      "directory completion maps the synchronized department leader as manager",
      "directory authority conflict is durable instead of silently overwritten",
    ]) {
      expect(tests).toContain(proof);
    }
  });
});
