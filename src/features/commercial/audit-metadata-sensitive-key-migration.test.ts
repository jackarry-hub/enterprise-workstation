// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("audit metadata sensitive-key precision migration", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/202609030004_audit_metadata_sensitive_key_precision.sql"),
    "utf8",
  ).toLowerCase();

  it("normalizes key spelling and blocks credential or one-time authorization keys", () => {
    expect(sql).toContain("v_normalized_key := regexp_replace(lower(v_key), '[^a-z0-9]+', '', 'g')");
    for (const marker of [
      "token", "secret", "authorization", "cookie", "servicerole",
      "password", "privatekey", "apikey", "oauth", "otp",
      "verificationcode", "onetimecode", "resetcode", "invitecode",
      "accesscode", "authcode", "codeverifier",
    ]) expect(sql).toContain(marker);
  });

  it("does not classify every business code field as a secret", () => {
    expect(sql).not.toMatch(/\|code\||\(code\||\|code\)/);
    expect(sql).toContain("errorcode, rolecode and providercode are safe");
    expect(sql).toContain("revoke all on function public.jsonb_has_sensitive_key(jsonb)");
  });
});
