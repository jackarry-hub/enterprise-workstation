import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("customer CRM schema migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/202608280001_customer_crm.sql"),
    "utf8",
  ).toLowerCase();

  it("creates the authoritative customer workflow tables", () => {
    for (const table of [
      "customers", "customer_contacts", "opportunities",
      "customer_follow_ups", "customer_project_links",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("uses exact tenant and organization foreign keys", () => {
    expect(sql).toContain("foreign key (tenant_id, organization_id, customer_id)");
    expect(sql).toContain("references public.customers(tenant_id, organization_id, id)");
    expect(sql).toContain("foreign key (tenant_id, organization_id, project_id)");
    expect(sql).toContain("references public.projects(tenant_id, organization_id, id)");
    expect(sql).toContain("foreign key (tenant_id, organization_id, customer_id, opportunity_id)");
    expect(sql.match(/member\.user_id=\(select auth\.uid\(\)\)/g)?.length).toBe(2);
  });

  it("deduplicates active customers without destroying archive history", () => {
    expect(sql).toContain("customers_active_normalized_name_uidx");
    expect(sql).toContain("customers_active_registration_code_uidx");
    expect(sql).toMatch(/where archived_at is null/);
  });

  it("allows only scoped reads and closes every direct write boundary", () => {
    expect(sql).toContain("create or replace function public.can_read_current_customer");
    expect(sql).toContain("permission.code='customer.manage'");
    expect(sql).toMatch(/revoke all on table public\.customers from public,anon,authenticated,service_role/);
    expect(sql).toContain("grant select on table public.customers to authenticated");
    expect(sql).not.toContain("grant insert");
    expect(sql).not.toContain("grant update");
    expect(sql).not.toContain("grant delete");
    expect(sql).toContain("amount <> 'nan'::numeric");
  });
});

describe("customer CRM command migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/202608280002_customer_commands.sql"),
    "utf8",
  ).toLowerCase();

  it("binds commands to the exact authenticated active member and permission", () => {
    expect(sql).toContain("member.user_id=(select auth.uid()) and member.status='active'");
    expect(sql).toContain("external.auth_user_id=(select auth.uid()) and external.status='active'");
    expect(sql).toContain("permission.code='customer.manage'");
    expect(sql).toContain("provider.status='active'");
  });

  it("uses an actor, target and payload-bound durable idempotency ledger", () => {
    expect(sql).toContain("create table public.crm_command_idempotency");
    expect(sql).toContain("actor_member_id bigint not null");
    expect(sql).toContain("target_public_id uuid not null");
    expect(sql).toContain("payload_digest text not null");
    expect(sql).toContain("v_actor<>p_actor_member_id");
    expect(sql).toContain("v_digest<>v_expected_digest");
    expect(sql).toContain("for update;");
  });

  it("uses owner validation locks compatible with foreign-key key-share checks", () => {
    expect(sql.match(/for share of profile,member;/g)?.length).toBe(2);
    expect(sql).not.toContain("for update of profile,member;");
  });

  it("keeps direct writes and internal helpers closed", () => {
    expect(sql).toContain("revoke all on table public.crm_command_idempotency from public,anon,authenticated,service_role");
    for (const helper of [
      "current_crm_command_identity()", "claim_crm_command(bigint,bigint,bigint,text,uuid,jsonb,uuid,uuid)",
      "complete_crm_command(bigint,bigint,uuid,bigint,text,text,text,text,uuid,uuid,text,text,text,jsonb)",
      "audit_crm_scope_conflict(bigint,bigint,uuid,bigint,text,text,text,uuid,uuid,text)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${helper}`);
    }
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete)\s+on/);
  });

  it("audits only contact digests and atomically replaces the primary contact", () => {
    expect(sql).toContain("'entitydigest',case when p_outcome='success' then encode(");
    expect(sql.match(/'businessreason',case when p_resource='customer_contact' then null else p_reason end/g)?.length).toBe(2);
    expect(sql.match(/'businessreasondigest',encode\(/g)?.length).toBe(2);
    expect(sql).not.toContain("'phone',p_phone");
    expect(sql).not.toContain("'email',p_email");
    expect(sql).toMatch(/if p_is_primary then\s+update public\.customer_contacts[\s\S]+insert into public\.customer_contacts/);
    expect(sql).toContain("version=contact.version+1");
  });
});
