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

describe("opportunity workflow migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/202608280003_opportunity_commands.sql"),
    "utf8",
  ).toLowerCase();

  it("adds the four authenticated workflow commands and closes every helper", () => {
    for (const signature of [
      "create_current_opportunity(uuid,text,uuid,numeric,text,date,bigint,text,uuid,uuid)",
      "transition_current_opportunity_stage(uuid,text,text,bigint,text,uuid,uuid)",
      "create_current_customer_follow_up(uuid,uuid,text,text,timestamptz,bigint,text,uuid,uuid)",
      "convert_current_opportunity_to_project(uuid,text,text,text,text,text,date,date,bigint,text,uuid,uuid)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature}`);
      expect(sql).toContain(`grant execute on function public.${signature}`);
    }
    expect(sql).toContain("revoke all on function public.current_project_command_context()");
    expect(sql).toContain("member.user_id=(select auth.uid()) and member.status='active'");
  });

  it("enforces the one-way stage machine under an optimistic row lock", () => {
    expect(sql).toContain("not isfinite(p_expected_close_on)");
    expect(sql).toContain("v_opportunity.stage='lead' and p_stage='qualified'");
    expect(sql).toContain("v_opportunity.stage='qualified' and p_stage='proposal'");
    expect(sql).toContain("v_opportunity.stage='proposal' and p_stage in ('won','lost')");
    expect(sql).toContain("for update;");
    expect(sql).toContain("'failure','invalid_stage'");
    expect(sql).toContain("v_opportunity.version<>p_expected_version");
    expect(sql).toContain("order by (profile.deleted_at is null) desc,profile.updated_at desc,profile.id desc");
    expect(sql).toContain("and profile.organization_member_id=v_opportunity.owner_member_id");
    expect(sql).toContain("limit 1;");
    expect(sql).not.toContain("and profile.organization_member_id=v_opportunity.owner_member_id and profile.deleted_at is null");
  });

  it("derives follow-up actor and occurrence time inside the database", () => {
    const start = sql.indexOf("create or replace function public.create_current_customer_follow_up");
    const end = sql.indexOf("$$;", start);
    const block = sql.slice(start, end);
    expect(block).toContain("v_now timestamptz:=clock_timestamp()");
    expect(block).toContain("v_opportunity_id,v_actor");
    expect(block).toContain("'actoremployeepublicid',v_actor_employee");
    expect(block).not.toContain("p_actor_member_id bigint,");
    expect(block).not.toContain("p_occurred_at");
    expect(sql).toContain("p_resource in ('customer_contact','customer_follow_up')");
    expect(block).toContain("not isfinite(p_next_follow_up_at)");
  });

  it("converts through the existing project RPC and rolls back project plus link together", () => {
    const start = sql.indexOf("create or replace function public.convert_current_opportunity_to_project");
    const end = sql.indexOf("$$;", start);
    const block = sql.slice(start, end);
    expect(block).toContain("v_project_result:=public.create_current_project_v2(");
    expect(block).toContain("insert into public.customer_project_links");
    expect(block).toContain("exception when unique_violation then v_failure:='already_converted'");
    expect(block).toContain("when others then v_failure:=coalesce(v_failure,'command_failed')");
    expect(block).toContain("v_opportunity.stage<>'won'");
    expect(block).toContain("not isfinite(p_starts_on)");
    expect(block).toContain("not isfinite(p_due_on)");
    expect(sql).toContain("customer_project_links_one_active_opportunity_uidx");
    expect(block).not.toContain("service_role");
  });
});

describe("customer CRM read models", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/202608280004_customer_read_models.sql"),
    "utf8",
  ).toLowerCase();

  it("preserves RLS and decimal precision for paginated list and detail reads", () => {
    for (const view of [
      "current_customer_opportunity_metrics",
      "current_customer_follow_up_metrics",
      "current_customer_opportunities",
      "current_customer_industries",
    ]) {
      expect(sql).toContain(`create view public.${view}`);
      expect(sql).toContain("security_invoker=true");
      expect(sql).toContain(`revoke all on table public.${view}`);
      expect(sql).toContain(`grant select on table public.${view} to authenticated`);
    }
    expect(sql).toContain("opportunity.amount::text as amount");
    expect(sql).toContain(")::text as won_amount_cny");
    expect(sql).toContain("min(follow_up.next_follow_up_at)");
    expect(sql).toContain("filter (where opportunity.stage<>'lost')");
  });
});

describe("commercial CRM governance migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/202608280005_crm_governance.sql"),
    "utf8",
  ).toLowerCase();

  it("adds immutable tenant-scoped governance and durable exchange records", () => {
    for (const table of [
      "customer_ownership_history", "opportunity_stage_history", "customer_contracts",
      "crm_source_links", "crm_import_jobs", "crm_import_rows", "crm_export_jobs",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
      expect(sql).toContain(`revoke all on table public.${table} from public,anon,authenticated,service_role`);
    }
    expect(sql).toContain("customer_ownership_history_reject_truncate");
    expect(sql).toContain("opportunity_stage_history_reject_truncate");
    expect(sql).toContain("crm_source_links_reject_truncate");
  });

  it("closes the legacy owner and contact PII bypasses", () => {
    expect(sql).toContain("'failure','ownership_transfer_required'");
    expect(sql).toContain("customers_guard_owner_transfer");
    expect(sql).toContain("revoke all on table public.customer_contacts from authenticated");
    expect(sql).toContain("list_current_customer_contacts(uuid[],boolean,integer)");
    expect(sql).toContain("customer.archived_at is null");
  });

  it("uses dedicated exchange permissions and keeps snapshots out of command results", () => {
    expect(sql).toContain("'customer.import'");
    expect(sql).toContain("'customer.export'");
    expect(sql).toContain("'customer.export_pii'");
    expect(sql).toContain("create or replace function public.begin_current_crm_import");
    expect(sql).toContain("create or replace function public.finalize_current_crm_import");
    expect(sql).toContain("create or replace function public.download_current_crm_export");
    expect(sql).toContain("create or replace function public.purge_expired_crm_exports");
    expect(sql).toContain("accepted_manifest jsonb not null");
    expect(sql).toContain("compute_crm_import_row_digest");
    expect(sql).toContain("where exchange.code in ('customer.import','customer.export')");
    expect(sql).not.toContain("where exchange.code in ('customer.import','customer.export','customer.export_pii')");
    const exportStart = sql.indexOf("create or replace function public.request_current_crm_export");
    const downloadStart = sql.indexOf("create or replace function public.download_current_crm_export");
    const requestBlock = sql.slice(exportStart, downloadStart);
    expect(requestBlock).toContain("insert into public.crm_export_jobs");
    expect(requestBlock).toContain("'downloadurl'");
    expect(requestBlock).not.toContain("'rows',v_job.snapshot");
  });

  it("records stage and owner events under fixed command boundaries", () => {
    expect(sql).toContain("after insert or update of stage on public.opportunities");
    expect(sql).toContain("set_config('quantxy.crm_stage_reason_digest'");
    expect(sql).toMatch(/claim_crm_command[\s\S]+select \* into v_customer[\s\S]+for update;[\s\S]+select \* into v_opportunity/);
    expect(sql).toContain("insert into public.customer_ownership_history");
    expect(sql).toContain("set_config('quantxy.crm_owner_transfer','allowed',true)");
  });
});

describe("customer CRM pgTAP contract", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/tests/customer_crm.sql"), "utf8");

  it("keeps the declared pgTAP plan synchronized with every assertion", () => {
    const planned = Number(/select plan\((\d+)\)/i.exec(sql)?.[1]);
    const assertions = sql.match(/^select\s+(?:ok|is|isnt|like|unlike|cmp_ok|throws_ok|lives_ok|results_eq|set_eq|bag_eq|row_eq|has_[a-z_]+|col_[a-z_]+|function_[a-z_]+)\s*\(/gim)?.length ?? 0;
    expect(planned).toBe(167);
    expect(assertions).toBe(planned);
  });
});
