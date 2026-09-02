import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("enterprise activation migration", () => {
  it("activates the enterprise and its Feishu directory connection atomically", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202609020002_enterprise_activation_directory_connection.sql"), "utf8").toLowerCase();
    expect(sql).toContain("activate_current_enterprise");
    expect(sql).toContain("initialize_current_enterprise");
    expect(sql).toContain("ensure_current_feishu_directory_connection");
    expect(sql).toContain("on conflict (tenant_id, organization_id, identity_provider_id) do update");
    expect(sql).toContain("'directory.connection.ready'");
    expect(sql).toContain("revoke all on function public.ensure_current_feishu_directory_connection(uuid)");
  });
});
