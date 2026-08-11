import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const approvalsMigrationUrl = new URL(
  "../../supabase/migrations/202608040005_approvals.sql",
  import.meta.url,
);
const salaryMigrationUrl = new URL(
  "../../supabase/migrations/202608040006_salary.sql",
  import.meta.url,
);
const professionalMigrationUrl = new URL(
  "../../supabase/migrations/202608080001_professional_workstation.sql",
  import.meta.url,
);
const identityMigrationUrl = new URL(
  "../../supabase/migrations/202608100001_phase1_identity_rbac.sql",
  import.meta.url,
);

test("approval requester policy qualifies outer-row columns", async () => {
  const sql = await readFile(approvalsMigrationUrl, "utf8");

  assert.match(sql, /employee\.id = approvals\.applicant_employee_id/);
  assert.match(sql, /employee\.organization_id = approvals\.organization_id/);
});

test("salary self-service policy qualifies outer-row columns", async () => {
  const sql = await readFile(salaryMigrationUrl, "utf8");

  assert.match(sql, /employee\.id = salary\.employee_profile_id/);
  assert.match(sql, /employee\.organization_id = salary\.organization_id/);
});

test("professional leave read policy has balanced closing parentheses", async () => {
  const sql = await readFile(professionalMigrationUrl, "utf8");
  const policy = sql
    .split(/\r?\n/)
    .find((line) => line.startsWith("create policy professional_leave_read"));

  assert.ok(policy);
  assert.match(policy, /array\['owner', 'admin', 'hr'\]\)\);$/);
});

test("identity claim uses single record targets for composite query results", async () => {
  const sql = await readFile(identityMigrationUrl, "utf8");

  assert.doesNotMatch(sql, /into v_external,\s*v_member_status/);
  assert.doesNotMatch(sql, /into v_provider,\s*v_identity_data/);
  assert.match(sql, /into v_bound_identity/);
  assert.match(sql, /into v_provider_identity/);
});
