import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  runDbCommand,
} from "./db-command-runner.mjs";

const localDatabaseUrl = "postgresql://postgres:local-password@127.0.0.1:54322/postgres";

test("rejects unsafe database requests before a DB CLI process can spawn", async () => {
  let spawnCount = 0;

  await assert.rejects(
    () => runDbCommand({
      command: "db:reset:test",
      environment: "unknown",
      databaseUrl: localDatabaseUrl,
      spawnProcess: () => { spawnCount += 1; return { status: 0 }; },
    }),
    /environment_mutation_forbidden/,
  );
  await assert.rejects(
    () => runDbCommand({
      command: "db:test",
      environment: "production",
      databaseUrl: localDatabaseUrl,
      spawnProcess: () => { spawnCount += 1; return { status: 0 }; },
    }),
    /environment_mutation_forbidden/,
  );
  await assert.rejects(
    () => runDbCommand({
      command: "db:seed:validate",
      environment: "internal",
      databaseUrl: localDatabaseUrl,
      spawnProcess: () => { spawnCount += 1; return { status: 0 }; },
    }),
    /environment_mutation_forbidden/,
  );
  await assert.rejects(
    () => runDbCommand({
      command: "db:reset:test",
      environment: "local",
      databaseUrl: "https://prod.example",
      spawnProcess: () => { spawnCount += 1; return { status: 0 }; },
    }),
    /environment_mutation_forbidden/,
  );
  await assert.rejects(
    () => runDbCommand({
      command: "db:reset:test",
      environment: "staging",
      databaseUrl: "postgresql://postgres:password@db.staging.example:5432/postgres",
      spawnProcess: () => { spawnCount += 1; return { status: 0 }; },
    }),
    /environment_mutation_forbidden/,
  );
  assert.equal(spawnCount, 0);
});

test("rejects a Staging URL that does not match the server-only host fingerprint before spawn", async () => {
  const previousHost = process.env.QUANTXY_STAGING_DATABASE_HOST;
  let spawnCount = 0;
  try {
    process.env.QUANTXY_STAGING_DATABASE_HOST = "db.expected.supabase.co";
    await assert.rejects(
      () => runDbCommand({
        command: "db:migrate:dry-run",
        environment: "Staging",
        databaseUrl: "postgresql://sensitive-user:top-secret-password@db.other.supabase.co:5432/postgres",
        spawnProcess: () => { spawnCount += 1; return { status: 0 }; },
      }),
      (error) => {
        assert.match(error.message, /environment_mutation_forbidden/);
        assert.doesNotMatch(error.message, /sensitive-user|top-secret-password|other/);
        return true;
      },
    );
    assert.equal(spawnCount, 0);
  } finally {
    if (previousHost === undefined) delete process.env.QUANTXY_STAGING_DATABASE_HOST;
    else process.env.QUANTXY_STAGING_DATABASE_HOST = previousHost;
  }
});

test("runs a Local pgTAP command with an injected DB CLI only after the guard returns a safe fingerprint", async () => {
  const invocations = [];

  const result = await runDbCommand({
    command: "db:test",
    environment: "CI/Test",
    databaseUrl: localDatabaseUrl,
    spawnProcess: (executable, args, options) => {
      invocations.push({ executable, args, options });
      return { status: 0 };
    },
  });

  assert.equal(result.status, 0);
  assert.deepEqual(result.fingerprint.toJSON(), {
    command: "db:test",
    environment: "CI/Test",
    target: "local_supabase_postgres",
  });
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].options.shell, false);
  assert.equal(invocations[0].options.stdio, "ignore");
  assert.ok(invocations[0].args.includes("supabase"));
  assert.ok(invocations[0].args.includes("test"));
  assert.match(JSON.stringify(invocations[0].args), /local-password/);
  assert.doesNotMatch(JSON.stringify(result), /local-password/);
});

test("reports an unavailable local CLI as BLOCKED instead of a successful database gate", async () => {
  const result = await runDbCommand({
    command: "db:migrate:dry-run",
    environment: "Local",
    databaseUrl: localDatabaseUrl,
    spawnProcess: () => ({ status: 1 }),
  });

  assert.equal(result.status, 1);
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.failureCategory, "database_cli_failed");
  assert.doesNotMatch(JSON.stringify(result), /local-password/);
});

test("keeps a rejected database URL's username and password out of CLI output", () => {
  const result = spawnSync(process.execPath, [
    resolve(process.cwd(), "scripts/db-command-runner.mjs"),
    "db:reset:test",
    "--environment",
    "Local",
    "--database-url",
    "postgresql://sensitive-user:top-secret-password@prod.example:5432/postgres",
  ], {
    encoding: "utf8",
    shell: false,
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /BLOCKED database_command=db:reset:test reason=environment_mutation_forbidden/);
  assert.doesNotMatch(output, /sensitive-user|top-secret-password|prod\.example/);
});

test("declares only the safe named database aliases and preserves existing phase commands", async () => {
  const packageJson = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  const required = [
    "db:reset:test",
    "db:migrate:dry-run",
    "db:test",
    "db:seed:validate",
    "db:rollback:test",
    "test:coverage",
    "test:security",
    "test:rls",
  ];

  for (const command of required) assert.equal(typeof packageJson.scripts[command], "string", `${command} must be registered`);
  assert.equal(Object.hasOwn(packageJson.scripts, "db:reset"), false);
  for (const command of required.filter((command) => command.startsWith("db:"))) {
    assert.match(packageJson.scripts[command], /scripts\/db-command-runner\.mjs/);
  }
  for (const command of ["test:coverage", "test:security", "test:rls"]) {
    assert.match(packageJson.scripts[command], /scripts\/phase-gates\.mjs/);
  }
  assert.equal(packageJson.devDependencies["@vitest/coverage-v8"], "4.1.10");
  assert.equal(typeof packageJson.scripts["phase1:verify"], "string");
  assert.equal(typeof packageJson.scripts["phase2:verify"], "string");
});
