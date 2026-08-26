import assert from "node:assert/strict";
import test from "node:test";

import { runSupabaseCommand } from "./supabase-command.mjs";

const localDatabaseUrl = "postgresql://postgres:local-password@127.0.0.1:54322/postgres";

test("delegates Phase2 dry-run only to the canonical guarded migration command", async () => {
  const delegated = [];
  const result = await runSupabaseCommand("dry-run", {
    environment: "Local",
    databaseUrl: localDatabaseUrl,
    runDbCommandImpl: async (request) => {
      delegated.push(request);
      return { outcome: "PASSED", status: 0, fingerprint: { toJSON: () => ({ target: "local_supabase_postgres" }) } };
    },
  });

  assert.equal(result.outcome, "PASSED");
  assert.equal(delegated.length, 1);
  assert.equal(delegated[0].command, "db:migrate:dry-run");
  assert.equal(delegated[0].environment, "Local");
  assert.equal(delegated[0].databaseUrl, localDatabaseUrl);
});

test("blocks Phase2 check and push without constructing any direct database CLI process", async () => {
  let delegated = 0;
  for (const mode of ["check", "push"]) {
    const result = await runSupabaseCommand(mode, {
      environment: "Local",
      databaseUrl: localDatabaseUrl,
      runDbCommandImpl: async () => { delegated += 1; return { outcome: "PASSED", status: 0 }; },
    });
    assert.deepEqual(result, {
      failureCategory: "database_command_forbidden",
      outcome: "BLOCKED",
      status: 1,
    });
  }
  assert.equal(delegated, 0);
});

test("blocks remote Phase2 db-test and unknown environment dry-run before a database process can spawn", async () => {
  let spawnCount = 0;
  for (const [mode, environment] of [["db-test", "Staging"], ["dry-run", "Internal"]]) {
    const result = await runSupabaseCommand(mode, {
      environment,
      databaseUrl: environment === "Staging"
        ? "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/postgres?sslmode=require"
        : localDatabaseUrl,
      spawnProcess: () => { spawnCount += 1; return { status: 0 }; },
    });
    assert.deepEqual(result, {
      failureCategory: "environment_mutation_forbidden",
      outcome: "BLOCKED",
      status: 1,
    });
  }
  assert.equal(spawnCount, 0);
});

test("does not expose the former direct Supabase command builder as a bypass API", async () => {
  const phase2Commands = await import("./supabase-command.mjs");
  assert.equal(typeof phase2Commands.buildSupabaseCommand, "undefined");
  assert.equal(typeof phase2Commands.buildSupabaseProcess, "undefined");
});
