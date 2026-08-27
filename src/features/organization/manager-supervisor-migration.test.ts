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

function lastFunctionBlock(name: string) {
  const migration = sql();
  const start = migration.lastIndexOf(`create or replace function public.${name}(`);
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

  it("repairs every unsafe legacy manager source with durable public evidence", () => {
    const migration = sql();
    const classifyDirectory = functionBlock("classify_legacy_directory_manager_relationships");
    const repair = functionBlock("repair_legacy_manager_relationships");
    const repairsUnsafeLinksAcrossSources = (block: string) => block.includes("with recursive legacy_manager_chain")
      && /from public\.employee_profiles target\s+where target\.manager_employee_id is not null\s+union all/.test(block)
      && block.includes("'legacy_manager_cycle'")
      && block.includes("'legacy_manager_department_mismatch'")
      && block.includes("'legacy_manager_inactive'")
      && block.includes("'legacy_target_inactive'")
      && block.includes("manager_member.status = 'active'")
      && block.includes("manager.department_id is distinct from target.department_id")
      && block.includes("manager_employee_id = null")
      && block.includes("manager_version = target.manager_version + 1");
    const appendsPublicRepairEvidence = (block: string) => block.includes("public.append_audit_log")
      && block.includes("'profile.updated'")
      && block.includes("'employee_manager_relationship'")
      && block.includes("'repairreason'")
      && block.includes("'before'")
      && block.includes("'after'")
      && block.includes("target_public_id::text")
      && block.includes("manager_public_id");
    const preservesVerifiedDirectoryAuthority = (block: string) => block.includes("connection.provider_type = 'feishu'")
      && block.includes("target_link.connection_id = connection.id")
      && block.includes("manager_link.connection_id = connection.id")
      && block.includes("department_link.connection_id = connection.id")
      && block.includes("manager_profile.organization_member_id = department.leader_member_id")
      && block.includes("manager_source = 'directory'");
    expect(preservesVerifiedDirectoryAuthority(classifyDirectory)).toBe(true);
    expect(preservesVerifiedDirectoryAuthority(classifyDirectory.replaceAll(
      "manager_link.connection_id = connection.id",
      "manager_link.connection_id is not null",
    ))).toBe(false);
    expect(repairsUnsafeLinksAcrossSources(repair)).toBe(true);
    expect(repairsUnsafeLinksAcrossSources(repair.replace(
      "where target.manager_employee_id is not null",
      "where target.manager_source = 'manual' and target.manager_employee_id is not null",
    ))).toBe(false);
    expect(appendsPublicRepairEvidence(repair)).toBe(true);
    expect(appendsPublicRepairEvidence(repair.replace(
      "target_public_id::text",
      "target.id::text",
    ))).toBe(false);
    expect(migration).toContain("select public.repair_legacy_manager_relationships();");
  });

  it("prelocks exact Task 7 organization trees and fails closed for uncoordinated lifecycle writers", () => {
    const migration = sql();
    const offboarding = lastFunctionBlock("revoke_departed_member_access");
    const legacyDirectory = lastFunctionBlock("apply_feishu_directory_sync");
    const observedDirectory = lastFunctionBlock("apply_feishu_directory_sync_observed");
    const exactDirectory = lastFunctionBlock("apply_feishu_directory_sync_exact");
    const fencedDirectory = lastFunctionBlock("apply_feishu_directory_sync_fenced");
    const lockGuard = functionBlock("require_employee_manager_tree_lock");
    const reconcile = functionBlock("reconcile_employee_manager_lifecycle_changes");
    const memberCleanup = functionBlock("cleanup_employee_managers_for_member_status");
    const invariant = functionBlock("enforce_employee_manager_invariants");
    const command = functionBlock("assign_current_member_manager");
    const exactLockBeforeDelegate = (block: string, delegate: string) => {
      const lock = block.indexOf("pg_advisory_xact_lock(");
      const call = block.indexOf(delegate);
      return block.includes("'manager-tree:' || v_tenant_id::text || ':' || v_organization_id::text")
        && lock >= 0
        && call > lock;
    };
    const reconcilesFinalStatement = (block: string) => block.includes("pg_trigger_depth() > 1")
      && block.includes("from new_profiles changed")
      && block.includes("join old_profiles previous")
      && block.includes("order by target.tenant_id, target.organization_id, target.id")
      && block.includes("for update of target")
      && block.includes("manager_employee_id = null")
      && block.includes("target.manager_employee_id = changed.id");
    const serializesMemberOffboarding = (block: string) => block.includes("'manager-tree:' || v_member.tenant_id::text || ':' || v_member.organization_id::text")
      && block.includes("from pg_catalog.pg_locks held_lock")
      && block.includes("raise exception 'manager_tree_lock_required'")
      && !block.includes("pg_advisory_xact_lock(")
      && /order by target\.id\s+for update of target/.test(block);
    const enforcesManagerSide = (block: string) => block.includes("candidate.id = new.id")
      && block.includes("candidate.manager_employee_id = new.id")
      && block.includes("manager.employment_status in ('probation', 'active', 'on_leave')")
      && block.includes("manager_member.status = 'active'")
      && block.includes("v_manager.department_id is distinct from target.department_id")
      && block.includes("with recursive reporting_chain");

    expect(exactLockBeforeDelegate(offboarding, "task8_legacy_revoke_departed_member_access(")).toBe(true);
    expect(offboarding).toContain("profile.public_id = p_member_public_id");
    expect(exactLockBeforeDelegate(legacyDirectory, "task8_legacy_apply_feishu_directory_sync(")).toBe(true);
    expect(legacyDirectory).toContain("order by organization.id");
    expect(legacyDirectory).toContain("provider.provider_code = 'feishu'");
    expect(exactLockBeforeDelegate(observedDirectory, "task8_legacy_apply_feishu_directory_sync_observed(")).toBe(true);
    expect(observedDirectory).toContain("order by organization.id");
    expect(exactLockBeforeDelegate(exactDirectory, "task8_legacy_apply_feishu_directory_sync_exact(")).toBe(true);
    expect(exactDirectory).toContain("run.public_id = p_run_id");
    expect(exactDirectory).toContain("run.request_id = p_run_id");
    expect(exactDirectory).toContain("connection.provider_type = 'feishu'");
    expect(exactLockBeforeDelegate(fencedDirectory, "task8_legacy_apply_feishu_directory_sync_fenced(")).toBe(true);
    expect(fencedDirectory).toContain("run.public_id = p_run_id");
    expect(fencedDirectory).toContain("organization.public_id = p_organization_public_id");
    expect(fencedDirectory).toContain("provider.status = 'active'");
    for (const wrapper of [offboarding, legacyDirectory, observedDirectory, exactDirectory, fencedDirectory]) {
      expect(wrapper).not.toContain("for update");
    }
    expect(migration).toContain("rename to task8_legacy_revoke_departed_member_access");
    expect(migration).toContain("rename to task8_legacy_apply_feishu_directory_sync");
    expect(migration).toContain("rename to task8_legacy_apply_feishu_directory_sync_exact");
    expect(migration).toContain("rename to task8_legacy_apply_feishu_directory_sync_fenced");
    expect(migration).toMatch(/revoke all on function public\.task8_legacy_revoke_departed_member_access\(uuid, text\)[\s\S]*from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/revoke all on function public\.task8_legacy_apply_feishu_directory_sync_fenced\(uuid, uuid, uuid, jsonb\)[\s\S]*from public, anon, authenticated, service_role/);
    expect(lockGuard).toContain("from pg_catalog.pg_locks held_lock");
    expect(lockGuard).toContain("held_lock.pid = pg_backend_pid()");
    expect(lockGuard).toContain("held_lock.locktype = 'advisory'");
    expect(lockGuard).toContain("raise exception 'manager_tree_lock_required'");
    expect(lockGuard).toContain("candidate.manager_employee_id = old.id");
    expect(lockGuard).not.toContain("pg_advisory_xact_lock(");
    expect(reconcilesFinalStatement(reconcile)).toBe(true);
    expect(reconcilesFinalStatement(reconcile.replace(
      "order by target.tenant_id, target.organization_id, target.id",
      "order by target.id desc",
    ))).toBe(false);
    expect(serializesMemberOffboarding(memberCleanup)).toBe(true);
    expect(serializesMemberOffboarding(memberCleanup.replace(
      "order by target.id",
      "order by target.id desc",
    ))).toBe(false);
    expect(command).toContain("hashtextextended('manager-tree:' || v_tenant::text || ':' || v_org::text, 0)");
    expect(migration).not.toContain("function public.lock_employee_manager_organizations_for_update(");
    expect(migration).not.toContain("create trigger employee_profiles_00_manager_tree_lock");
    expect(migration).toMatch(/create trigger employee_profiles_require_manager_tree_lock\s+before update of[\s\S]*manager_source[\s\S]*on public\.employee_profiles\s+for each row/);
    expect(migration).toMatch(/create trigger employee_profiles_manager_lifecycle_reconcile\s+after update on public\.employee_profiles\s+referencing old table as old_profiles new table as new_profiles\s+for each statement/);
    expect(migration).not.toContain("for each row execute function public.cleanup_employee_manager_relationships");
    expect(enforcesManagerSide(invariant)).toBe(true);
    expect(enforcesManagerSide(invariant.replace(
      "candidate.manager_employee_id = new.id",
      "candidate.manager_employee_id is not null",
    ))).toBe(false);
    expect(migration).toMatch(/create constraint trigger employee_profiles_manager_invariants[\s\S]*deferrable initially deferred/);
    expect(migration).toContain("create trigger organization_members_manager_status_cleanup");

    const behavior = pgTap();
    expect(behavior).toContain("test.organization_manager_dblink_available");
    expect(behavior).toContain("dblink_send_query");
    expect(behavior).toContain("dblink_cancel_query");
    expect(behavior).toContain("set statement_timeout = ''5s''");
    expect(behavior).toContain("set lock_timeout = ''3s''");
    expect(behavior).toContain("offboarding and manager assignment overlap completes without deadlock");
    expect(behavior).toContain("organization a lifecycle mutation does not block organization b manager command");
  });

  it("creates a distinct future-safe supervisor role and narrowly scoped permission", () => {
    const migration = sql();
    const canonical = functionBlock("is_canonical_workspace_role_code");
    const provision = functionBlock("ensure_supervisor_role_for_tenant");
    const quarantine = functionBlock("quarantine_legacy_supervisor_roles");
    const quarantineCall = "select public.quarantine_legacy_supervisor_roles();";
    const quarantinesWithoutReusing = (block: string) => block.includes("legacy.code = 'supervisor'")
      && block.includes("not legacy.is_system")
      && block.includes("legacy_supervisor_")
      && block.includes("collision.id <> v_role.id")
      && block.includes("is_enabled = false");

    expect(canonical).toMatch(/'owner'[\s\S]*'supervisor'[\s\S]*'employee'/);
    expect(quarantinesWithoutReusing(quarantine)).toBe(true);
    expect(quarantinesWithoutReusing(quarantine.replace(
      "collision.id <> v_role.id",
      "collision.id = v_role.id",
    ))).toBe(false);
    expect(migration).toContain(quarantineCall);
    expect(migration.indexOf(quarantineCall)).toBeLessThan(
      migration.indexOf("create or replace function public.is_canonical_workspace_role_code"),
    );
    expect(quarantine).not.toContain("delete from public.member_roles");
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
      && block.includes("active_tenant.id = external.tenant_id")
      && block.includes("active_tenant.status = 'active'")
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
    const suspendedTenantMutation = projection.replace(
      "active_tenant.status = 'active'",
      "active_tenant.status is not null",
    );
    expect(suspendedTenantMutation).not.toBe(projection);
    expect(enforcesBoundary(suspendedTenantMutation)).toBe(false);
    expect(sql()).toMatch(/grant execute on function public\.current_supervisor_employee_projection\(uuid\) to authenticated/);
    expect(sql()).toMatch(/revoke all on function public\.current_supervisor_employee_projection\(uuid\)\s+from public, anon, authenticated, service_role/);
  });

  it("allows a user to hold another organization membership without selecting it as the active workspace", () => {
    const migration = sql();

    expect(migration).toContain("drop index if exists public.organization_members_tenant_user_idx");
    expect(migration).toMatch(/create unique index if not exists organization_members_tenant_organization_user_idx[\s\S]*\(tenant_id, organization_id, user_id\)[\s\S]*where user_id is not null/);
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
      "legacy supervisor assignment remains quarantined without canonical scope escalation",
      "suspended tenant denies the direct supervisor projection rpc",
      "legacy upgrade clears direct invalid and departed manager relationships",
      "legacy upgrade clears directory-classified direct and transitive reporting cycles",
      "legacy manager repair audit has exact stable public before and after evidence",
      "legacy manager repair rerun creates no duplicate audit evidence",
      "multi-row directory move preserves the directory-owned manager mapping",
      "target department move cannot strand a cross-department manual manager",
      "manager department move cannot strand cross-department reports",
      "bulk manager and report departure completes without triggered-row modification",
      "bulk departure clears target and manager-side relationships after the full statement",
      "active-workspace user cannot select its second membership by target id",
      "active-workspace user cannot project its second membership by target id",
    ]) {
      expect(tests).toContain(proof);
    }
  });
});
