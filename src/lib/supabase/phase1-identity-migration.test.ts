import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("phase 1 tenant identity migration", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/202608100001_phase1_identity_rbac.sql"),
    "utf8",
  );
  const normalizedSql = sql.toLowerCase();

  it("adds explicit tenant boundaries and same-tenant relationship guards", () => {
    expect(sql).toContain("create table public.tenants");

    for (const table of [
      "organizations",
      "organization_members",
      "departments",
      "employee_profiles",
      "roles",
      "member_roles",
      "role_permissions",
    ]) {
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table}[\\s\\S]*?tenant_id`, "i"),
      );
    }

    for (const table of [
      "identity_providers",
      "external_identities",
      "audit_logs",
    ]) {
      expect(sql).toMatch(
        new RegExp(`create table public\\.${table} \\([\\s\\S]*?tenant_id`, "i"),
      );
    }

    expect(sql).toMatch(/unique\s*\(tenant_id,\s*id\)/i);
    expect(sql).toMatch(
      /foreign key\s*\(tenant_id,\s*organization_id\)\s*references public\.organizations\s*\(tenant_id,\s*id\)/i,
    );
    expect(sql).toMatch(
      /foreign key\s*\(tenant_id,\s*organization_member_id\)\s*references public\.organization_members\s*\(tenant_id,\s*id\)/i,
    );
    expect(sql).toContain("alter column user_id drop not null");
  });

  it("uses a provider-neutral identity core with least-privilege RPC grants", () => {
    expect(sql).toContain("create table public.identity_providers");
    expect(sql).toContain("create table public.external_identities");
    for (const field of [
      "provider_code",
      "auth_provider",
      "provider_subject",
      "provider_tenant_key",
      "provider_match_keys",
      "verified_email",
      "safe_metadata",
    ]) {
      expect(normalizedSql).toContain(field);
    }

    expect(sql).toMatch(
      /create or replace function public\.provision_employee_identity\([\s\S]*?p_tenant_slug[\s\S]*?p_organization_slug[\s\S]*?p_provider_code[\s\S]*?p_provider_tenant_key[\s\S]*?p_provider_subject[\s\S]*?p_provider_match_keys[\s\S]*?p_skills/i,
    );
    expect(sql).toContain(
      "create or replace function public.bind_preprovisioned_identity",
    );
    expect(sql).toContain(
      "create or replace function public.claim_current_identity",
    );
    expect(sql).toContain("create or replace function public.current_tenant_id");
    expect(sql).toContain(
      "create or replace function public.current_workspace_access",
    );

    expect(sql).toContain(
      "grant execute on function public.claim_current_identity() to authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.current_tenant_id() to authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.current_workspace_access() to authenticated",
    );
    expect(sql).toMatch(
      /grant execute on function public\.provision_employee_identity\([\s\S]*?\) to service_role;/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.bind_preprovisioned_identity\([\s\S]*?\) to service_role;/i,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.(?:provision_employee_identity|bind_preprovisioned_identity)\([^;]+to authenticated;/i,
    );
    expect(sql).not.toContain("claim_current_feishu_identity");
    expect(sql).not.toContain("provision_feishu_employee");
    expect(sql).not.toContain("feishu_open_id");
    expect(sql).not.toContain("feishu_union_id");
    expect(sql).not.toMatch(
      /check\s*\(\s*provider(?:_code)?\s*=\s*'feishu'\s*\)/i,
    );
  });

  it("normalizes bounded skills and adds sanitized append-only audit logs", () => {
    expect(sql).toMatch(
      /skills text\[\] not null default '\{\}'::text\[\]/i,
    );
    expect(sql).toContain("cardinality(new.skills) > 30");
    expect(sql).toContain("length(btrim(skill)) not between 1 and 40");
    expect(sql).toContain("array_agg(distinct lower(btrim(skill)))");

    expect(sql).toContain("create table public.audit_logs");
    expect(sql).toMatch(
      /revoke all on public\.audit_logs from public, anon, authenticated/i,
    );
    expect(sql).toContain("create or replace function public.append_audit_log");
    expect(sql).toContain("create trigger audit_logs_append_only");
    expect(sql).toContain("octet_length(p_metadata::text) > 8192");
    expect(sql).toContain("jsonb_typeof(p_metadata) <> 'object'");
    for (const forbidden of [
      "token",
      "secret",
      "authorization",
      "code",
      "cookie",
      "service_role",
    ]) {
      expect(normalizedSql).toContain(forbidden);
    }
    for (const action of [
      "identity.provisioned",
      "identity.claimed",
      "identity.revoked",
      "member.status_changed",
      "member.role_changed",
      "profile.updated",
      "roster.imported",
    ]) {
      expect(sql).toContain(`'${action}'`);
    }
  });

  it("enforces tenant-first RLS and returns only a safe workspace identity summary", () => {
    for (const table of [
      "organizations",
      "organization_members",
      "departments",
      "employee_profiles",
      "roles",
      "member_roles",
      "role_permissions",
      "identity_providers",
      "external_identities",
      "audit_logs",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
    expect(sql).toMatch(/tenant_id\s*=\s*\(select public\.current_tenant_id\(\)\)/i);
    for (const safeField of [
      "'tenantId'",
      "'providerCode'",
      "'authProvider'",
      "'providerSubject'",
    ]) {
      expect(sql).toContain(safeField);
    }
    for (const sensitiveField of [
      "'providerTenantKey'",
      "'providerMatchKeys'",
      "'openId'",
      "'unionId'",
      "'token'",
    ]) {
      expect(sql).not.toContain(sensitiveField);
    }
    expect(sql).not.toMatch(
      /create or replace function public\.current_workspace_access\(\)[\s\S]*?organization\.slug\s*=\s*'quantum-galaxy'/i,
    );
  });

  it("seeds only the QuantXY tenant, its primary organization, and the first provider", () => {
    expect(sql).toContain("'量子星河', 'quantxy'");
    expect(sql).toContain("'量子星河', 'quantum-galaxy'");
    expect(sql).toContain("'feishu', 'custom:feishu'");
    for (const name of [
      "AI事业部",
      "电商事业部",
      "运营部",
      "财务部",
      "人力资源部",
    ]) {
      expect(sql).toContain(name);
    }
    for (const role of ["owner", "department_head", "employee", "finance", "hr"]) {
      expect(sql).toContain(`'${role}'`);
    }
  });
});
