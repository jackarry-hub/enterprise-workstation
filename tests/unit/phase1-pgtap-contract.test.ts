import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Phase 1 pgTAP acceptance contract", () => {
  const sql = readFileSync(
    resolve("supabase/tests/phase1_identity_rbac.sql"),
    "utf8",
  );

  it("asserts the identity-claim audit event explicitly", () => {
    expect(sql).toContain("identity claim writes an audit event");
  });

  it("asserts an admin can read only current-tenant audit events", () => {
    expect(sql).toContain("admin can read current-tenant audit events");
    expect(sql).toContain("admin cannot read another tenant audit event");
  });
});
