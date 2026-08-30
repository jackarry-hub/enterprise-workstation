import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LOCAL_DATABASE_URL,
  inspectDatabaseReset,
  verifyDatabaseReset,
} from "./verify-database-reset.mjs";

test("the repository database reset preflight passes without claiming a database run", async () => {
  const report = await verifyDatabaseReset({ rootDir: process.cwd() });
  assert.equal(report.status, "STATIC_PASS");
  assert.equal(report.databaseExecuted, false);
  assert.equal(report.tableCount > 100, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.fingerprint.target, "local_supabase_postgres");
});

test("the shared environment guard rejects Internal and Production before filesystem inspection", async () => {
  const missingRoot = path.join(os.tmpdir(), "quantxy-database-preflight-missing-root");
  for (const environment of ["Internal", "Production"]) {
    await assert.rejects(
      verifyDatabaseReset({
        rootDir: missingRoot,
        environment,
        databaseUrl: LOCAL_DATABASE_URL,
      }),
      /environment_mutation_forbidden/,
    );
  }
});

test("static inspection fails closed when a public table is not forced behind RLS", async (context) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "quantxy-database-preflight-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(path.join(rootDir, "supabase", "migrations"), { recursive: true });
  await mkdir(path.join(rootDir, "supabase", "tests"), { recursive: true });
  await writeFile(
    path.join(rootDir, "supabase", "seed.sql"),
    "begin; -- quantxy-commercial-test quantxy-commercial-test-org tenant_quantxy_commercial_test seed_scope local-ci on conflict provision_employee_identity bind_preprovisioned_identity\n"
      + "select 'owner@quantxy-commercial.test', 'manager@quantxy-commercial.test', 'employee@quantxy-commercial.test', 'finance@quantxy-commercial.test', 'hr@quantxy-commercial.test';\n"
      + Array.from({ length: 12 }, (_, index) => `select '92000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}';`).join("\n")
      + "\ncommit;",
  );
  await writeFile(
    path.join(rootDir, "supabase", "migrations", "202608300001_fixture.sql"),
    "create table public.fixture(id bigint); alter table public.fixture enable row level security;\n"
      + "create trigger audit_events_append_only before update or delete on public.audit_events execute function public.reject_audit_event_mutation();\n"
      + "revoke update, delete on table public.audit_events from public, anon, authenticated, service_role;",
  );
  for (const [name, source] of [
    ["schema_security_invariants.sql", "begin; select no_plan(), 'relrowsecurity relforcerowsecurity role_table_grants audit_events'; select finish(); rollback;"],
    ["audit_immutability.sql", "begin; select no_plan(), 'audit_logs_append_only audit_events_append_only has_table_privilege throws_ok'; select finish(); rollback;"],
    ["workflow_transactions.sql", `begin; select no_plan(), 'project_command_idempotency task_command_idempotency approval_command_idempotency expense_command_idempotency ${[
      "create_current_project_v2",
      "transition_current_task",
      "submit_current_approval",
      "act_on_current_approval",
      "submit_current_expense",
      "mark_current_expense_paid",
      "enqueue_commercial_notification",
      "mark_current_notification_read",
    ].join(" ")}'; select finish(); rollback;`],
  ]) {
    await writeFile(path.join(rootDir, "supabase", "tests", name), source);
  }

  const report = await inspectDatabaseReset(rootDir);
  assert.equal(report.status, "STATIC_FAIL");
  assert.equal(report.databaseExecuted, false);
  assert.equal(report.issues.includes("force_rls_missing:fixture"), true);
});
