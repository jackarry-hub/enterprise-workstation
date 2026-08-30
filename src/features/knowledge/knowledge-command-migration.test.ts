import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202608300002_knowledge_commands.sql"), "utf8").toLowerCase();

describe("knowledge command migration", () => {
  it("derives identity server-side and makes commands idempotent and audited", () => {
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("active_workspace_organization_id");
    expect(sql).toContain("knowledge_command_receipts");
    expect(sql).toContain("idempotency_conflict");
    expect(sql).toContain("append_audit_log");
  });

  it("accepts only verified same-organization files before creating a version", () => {
    expect(sql).toContain("file.verified_at is not null");
    expect(sql).toContain("file.tenant_id=v_tenant");
    expect(sql).toContain("file.organization_id=v_org");
    expect(sql).toContain("unverified_file");
  });
});
