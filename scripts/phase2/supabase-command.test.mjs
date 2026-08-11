import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSupabaseCommand,
  buildSupabaseProcess,
} from "./supabase-command.mjs";

const dbUrl =
  "postgresql://postgres:password@db.abcxyz.supabase.co:5432/postgres";

test("builds a migration history connection check", () => {
  assert.deepEqual(buildSupabaseCommand("check", dbUrl), [
    "supabase",
    "migration",
    "list",
    "--db-url",
    dbUrl,
  ]);
});

test("builds a non-mutating migration dry-run", () => {
  assert.deepEqual(buildSupabaseCommand("dry-run", dbUrl), [
    "supabase",
    "db",
    "push",
    "--dry-run",
    "--db-url",
    dbUrl,
  ]);
});

test("builds a migration push without including seed data", () => {
  const command = buildSupabaseCommand("push", dbUrl);

  assert.deepEqual(command, [
    "supabase",
    "db",
    "push",
    "--yes",
    "--db-url",
    dbUrl,
  ]);
  assert.equal(command.includes("--include-seed"), false);
});

test("runs the existing identity pgTAP suite remotely", () => {
  assert.deepEqual(buildSupabaseCommand("db-test", dbUrl), [
    "supabase",
    "test",
    "db",
    "supabase/tests/phase1_identity_rbac.sql",
    "--db-url",
    dbUrl,
  ]);
});

test("rejects every command outside the fixed allowlist", () => {
  assert.throws(
    () => buildSupabaseCommand("reset", dbUrl),
    /不支持的 Phase2 命令/,
  );
});

test("launches npx through node on Windows without a command shell", () => {
  const process = buildSupabaseProcess(["supabase", "migration", "list"], {
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    npmExecPath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
  });

  assert.equal(process.executable, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(process.args, [
    "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js",
    "supabase",
    "migration",
    "list",
  ]);
});
