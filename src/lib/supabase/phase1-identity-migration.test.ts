import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("phase 1 identity migration", () => {
  const sql = readFileSync(resolve("supabase/migrations/202608100001_phase1_identity_rbac.sql"), "utf8");

  it("adds pre-provisioned Feishu identities and safe RPC boundaries", () => {
    expect(sql).toContain("create table public.external_identities");
    expect(sql).toContain("alter column user_id drop not null");
    expect(sql).toContain("create or replace function public.provision_feishu_employee");
    expect(sql).toContain("create or replace function public.bind_preprovisioned_member");
    expect(sql).toContain("create or replace function public.claim_current_feishu_identity");
    expect(sql).toContain("create or replace function public.current_workspace_access");
    expect(sql).toContain("grant execute on function public.claim_current_feishu_identity() to authenticated");
    expect(sql).toContain("grant execute on function public.provision_feishu_employee");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/grant execute on function public\.provision_feishu_employee\([^;\n]+to authenticated;/i);
  });

  it("seeds only the QuantXY organization used by the application", () => {
    expect(sql).toContain("'量子星河', 'quantum-galaxy'");
    for (const name of ["AI事业部", "电商事业部", "运营部", "财务部", "人力资源部"]) {
      expect(sql).toContain(name);
    }
  });
});
