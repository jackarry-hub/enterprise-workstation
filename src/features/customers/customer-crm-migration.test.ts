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
