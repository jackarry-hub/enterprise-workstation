import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertSafeDatabaseTarget } from "./environment-guard.mjs";

export const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const REQUIRED_TESTS = new Map([
  ["schema_security_invariants.sql", [
    "relrowsecurity",
    "relforcerowsecurity",
    "role_table_grants",
    "audit_events",
  ]],
  ["audit_immutability.sql", [
    "audit_logs_append_only",
    "audit_events_append_only",
    "has_table_privilege",
    "throws_ok",
  ]],
  ["workflow_transactions.sql", [
    "project_command_idempotency",
    "task_command_idempotency",
    "approval_command_idempotency",
    "expense_command_idempotency",
    "enqueue_commercial_notification",
  ]],
]);

const REQUIRED_WORKFLOW_RPCS = [
  "create_current_project_v2",
  "transition_current_task",
  "submit_current_approval",
  "act_on_current_approval",
  "submit_current_expense",
  "mark_current_expense_paid",
  "enqueue_commercial_notification",
  "mark_current_notification_read",
];

function normalizeSql(source) {
  return source.replace(/--[^\r\n]*/g, " ").replace(/\s+/g, " ").trim();
}

function capturedNames(source, expression) {
  return new Set([...source.matchAll(expression)].map((match) => match[1].toLowerCase()));
}

function migrationInvariants(migrations) {
  const source = normalizeSql(migrations.map((migration) => migration.source).join("\n"));
  const tables = capturedNames(
    source,
    /\bcreate\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z][a-z0-9_]*)/gi,
  );
  const rls = capturedNames(
    source,
    /\balter\s+table(?:\s+if\s+exists)?\s+public\.([a-z][a-z0-9_]*)\s+enable\s+row\s+level\s+security\b/gi,
  );
  const forced = capturedNames(
    source,
    /\balter\s+table(?:\s+if\s+exists)?\s+public\.([a-z][a-z0-9_]*)\s+force\s+row\s+level\s+security\b/gi,
  );
  return {
    tableCount: tables.size,
    missingRls: [...tables].filter((table) => !rls.has(table)).sort(),
    missingForceRls: [...tables].filter((table) => !forced.has(table)).sort(),
  };
}

function validateMigrationNames(migrations, issues) {
  let previous = "";
  for (const migration of migrations) {
    if (!/^\d{12}_[a-z0-9][a-z0-9_-]*\.sql$/.test(migration.name)) {
      issues.push(`migration_name_invalid:${migration.name}`);
    }
    if (previous && migration.name <= previous) {
      issues.push(`migration_order_invalid:${migration.name}`);
    }
    previous = migration.name;
  }
}

function validateSeed(seed, issues) {
  const normalized = normalizeSql(seed).toLowerCase();
  if (!/^begin\s*;/.test(normalized) || !/commit\s*;$/.test(normalized)) {
    issues.push("seed_transaction_boundary_missing");
  }
  if (/\b(?:truncate|drop|delete)\b/.test(normalized)) {
    issues.push("seed_destructive_statement_forbidden");
  }
  for (const marker of [
    "quantxy-commercial-test",
    "quantxy-commercial-test-org",
    "tenant_quantxy_commercial_test",
    "seed_scope",
    "local-ci",
    "on conflict",
    "provision_employee_identity",
    "bind_preprovisioned_identity",
  ]) {
    if (!normalized.includes(marker)) issues.push(`seed_marker_missing:${marker}`);
  }
  const stableIds = new Set(seed.match(/92000000-0000-4000-8000-[0-9]{12}/g) ?? []);
  if (stableIds.size < 12) issues.push("seed_deterministic_identity_set_incomplete");
  const emails = seed.match(/[a-z0-9._%+-]+@[a-z0-9.-]+/gi) ?? [];
  if (emails.length < 5 || emails.some((email) => !email.toLowerCase().endsWith(".test"))) {
    issues.push("seed_email_scope_not_test_only");
  }
  if (/https?:\/\//i.test(seed) || /\b(?:sk|pk)_(?:live|prod)_/i.test(seed) || /eyj[a-z0-9_-]{20,}/i.test(seed)) {
    issues.push("seed_external_or_secret_material_forbidden");
  }
}

function validateInvariantTest(name, source, markers, issues) {
  const normalized = normalizeSql(source).toLowerCase();
  if (!/^begin\s*;/.test(normalized) || !/rollback\s*;$/.test(normalized)) {
    issues.push(`test_transaction_boundary_missing:${name}`);
  }
  for (const marker of ["no_plan", "finish", ...markers]) {
    if (!normalized.includes(marker.toLowerCase())) issues.push(`test_marker_missing:${name}:${marker}`);
  }
}

function validateAuditHardening(migrationSource, issues) {
  const normalized = normalizeSql(migrationSource).toLowerCase();
  for (const marker of [
    "audit_events_append_only",
    "before update or delete on public.audit_events",
    "revoke update, delete on table public.audit_events from public, anon, authenticated, service_role",
  ]) {
    if (!normalized.includes(marker)) issues.push(`audit_hardening_missing:${marker}`);
  }
}

async function loadMigrations(rootDir) {
  const migrationsDir = path.join(rootDir, "supabase", "migrations");
  const names = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return Promise.all(names.map(async (name) => ({
    name,
    source: await readFile(path.join(migrationsDir, name), "utf8"),
  })));
}

export async function inspectDatabaseReset(rootDir) {
  const issues = [];
  const seed = await readFile(path.join(rootDir, "supabase", "seed.sql"), "utf8");
  const migrations = await loadMigrations(rootDir);
  validateMigrationNames(migrations, issues);
  validateSeed(seed, issues);

  const invariants = migrationInvariants(migrations);
  for (const table of invariants.missingRls) issues.push(`rls_missing:${table}`);
  for (const table of invariants.missingForceRls) issues.push(`force_rls_missing:${table}`);
  validateAuditHardening(migrations.map((migration) => migration.source).join("\n"), issues);

  const testDir = path.join(rootDir, "supabase", "tests");
  for (const [name, markers] of REQUIRED_TESTS) {
    const source = await readFile(path.join(testDir, name), "utf8");
    validateInvariantTest(name, source, markers, issues);
    if (name === "workflow_transactions.sql") {
      for (const rpc of REQUIRED_WORKFLOW_RPCS) {
        if (!source.includes(rpc)) issues.push(`workflow_rpc_missing:${rpc}`);
      }
    }
  }

  return {
    status: issues.length === 0 ? "STATIC_PASS" : "STATIC_FAIL",
    databaseExecuted: false,
    migrationCount: migrations.length,
    tableCount: invariants.tableCount,
    issues,
  };
}

export async function verifyDatabaseReset({
  rootDir = process.cwd(),
  command = "db:seed:validate",
  environment = "Local",
  databaseUrl = LOCAL_DATABASE_URL,
} = {}) {
  const fingerprint = assertSafeDatabaseTarget({ command, environment, databaseUrl });
  const report = await inspectDatabaseReset(rootDir);
  if (report.status !== "STATIC_PASS") {
    const error = new Error("database_reset_static_verification_failed");
    error.report = report;
    throw error;
  }
  return { ...report, fingerprint };
}

async function runCli() {
  try {
    const report = await verifyDatabaseReset({
      rootDir: process.cwd(),
      command: process.env.QUANTXY_DATABASE_COMMAND ?? "db:seed:validate",
      environment: process.env.QUANTXY_ENVIRONMENT ?? "Local",
      databaseUrl: process.env.QUANTXY_DATABASE_URL ?? LOCAL_DATABASE_URL,
    });
    console.log(JSON.stringify(report));
  } catch (error) {
    const report = error?.report;
    console.error(JSON.stringify({
      status: "STATIC_FAIL",
      databaseExecuted: false,
      reason: error?.message === "environment_mutation_forbidden"
        ? "environment_mutation_forbidden"
        : error?.message === "database_command_forbidden"
          ? "database_command_forbidden"
          : "database_reset_static_verification_failed",
      issues: report?.issues ?? [],
    }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
