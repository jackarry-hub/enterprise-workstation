import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  formatDbCommandResult,
  runDbCommand,
} from "./db-command-runner.mjs";

const localDatabaseUrl = "postgresql://postgres:local-password@127.0.0.1:54322/postgres";

function installStagingFingerprint() {
  const keys = [
    "QUANTXY_STAGING_DATABASE_HOST",
    "QUANTXY_STAGING_DATABASE_PORT",
    "QUANTXY_STAGING_DATABASE_NAME",
    "QUANTXY_STAGING_DATABASE_USER",
    "QUANTXY_STAGING_DATABASE_SSLMODE",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    QUANTXY_STAGING_DATABASE_HOST: "db.abcxyz.supabase.co",
    QUANTXY_STAGING_DATABASE_PORT: "5432",
    QUANTXY_STAGING_DATABASE_NAME: "postgres",
    QUANTXY_STAGING_DATABASE_USER: "postgres",
    QUANTXY_STAGING_DATABASE_SSLMODE: "require",
  });
  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

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
  const restore = installStagingFingerprint();
  let spawnCount = 0;
  try {
    process.env.QUANTXY_STAGING_DATABASE_HOST = "db.expected.supabase.co";
    await assert.rejects(
      () => runDbCommand({
        command: "db:migrate:dry-run",
        environment: "Staging",
        databaseUrl: "postgresql://sensitive-user:top-secret-password@db.other.supabase.co:5432/postgres?sslmode=require",
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
    restore();
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
  assert.deepEqual(invocations[0].options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(invocations[0].options.timeout, 300_000);
  assert.equal(invocations[0].options.maxBuffer, 1_048_576);
  assert.ok(invocations[0].args.includes("supabase"));
  assert.ok(invocations[0].args.includes("test"));
  assert.match(JSON.stringify(invocations[0].args), /local-password/);
  assert.doesNotMatch(JSON.stringify(result), /local-password/);
});

test("uses command-specific bounded database CLI timeouts and accepts only a bounded server-only override", async () => {
  const previousTimeout = process.env.QUANTXY_DB_COMMAND_TIMEOUT_MS;
  const timeouts = [];
  const invoke = async (command) => runDbCommand({
    command,
    environment: "Local",
    databaseUrl: localDatabaseUrl,
    spawnProcess: (_executable, _args, options) => {
      timeouts.push(options.timeout);
      return { status: 0 };
    },
  });
  try {
    delete process.env.QUANTXY_DB_COMMAND_TIMEOUT_MS;
    await invoke("db:migrate:dry-run");
    await invoke("db:test");
    await invoke("db:reset:test");
    assert.deepEqual(timeouts, [300_000, 300_000, 600_000]);

    process.env.QUANTXY_DB_COMMAND_TIMEOUT_MS = "90000";
    await invoke("db:test");
    assert.equal(timeouts.at(-1), 90_000);

    process.env.QUANTXY_DB_COMMAND_TIMEOUT_MS = "900001";
    await invoke("db:test");
    assert.equal(timeouts.at(-1), 300_000);
  } finally {
    if (previousTimeout === undefined) delete process.env.QUANTXY_DB_COMMAND_TIMEOUT_MS;
    else process.env.QUANTXY_DB_COMMAND_TIMEOUT_MS = previousTimeout;
  }
});

test("rejects inherited and unknown command names before any Local or Staging process can spawn", async () => {
  const restore = installStagingFingerprint();
  let spawnCount = 0;
  try {
    for (const environment of ["Local", "Staging"]) {
      const databaseUrl = environment === "Local"
        ? localDatabaseUrl
        : "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/postgres?sslmode=require";
      for (const command of ["unknown", "constructor", "toString", "__proto__"]) {
        await assert.rejects(
          () => runDbCommand({
            command,
            environment,
            databaseUrl,
            spawnProcess: () => { spawnCount += 1; return { status: 0 }; },
          }),
          /database_command_forbidden/,
        );
      }
    }
    assert.equal(spawnCount, 0);
  } finally {
    restore();
  }
});

test("blocks seed and rollback aliases until their independent verifier contract exists without remapping either to reset", async () => {
  let spawnCount = 0;
  for (const command of ["db:seed:validate", "db:rollback:test"]) {
    const result = await runDbCommand({
      command,
      environment: "Local",
      databaseUrl: localDatabaseUrl,
      spawnProcess: () => { spawnCount += 1; return { status: 0 }; },
    });
    assert.deepEqual(result.fingerprint.toJSON(), {
      command,
      environment: "Local",
      target: "local_supabase_postgres",
    });
    assert.equal(result.failureCategory, "database_verifier_unavailable");
    assert.equal(result.outcome, "BLOCKED");
    assert.equal(result.status, 1);
    assert.deepEqual(result.evidence, {
      errorSummary: "database_verifier_unavailable",
      failedTest: undefined,
      failedTestNumber: undefined,
      migration: undefined,
      testCount: undefined,
    });
  }
  assert.equal(spawnCount, 0);
});

test("returns allowlisted pgTAP and migration failure evidence without returning raw CLI streams", async () => {
  const captured = [];
  const result = await runDbCommand({
    command: "db:test",
    environment: "Local",
    databaseUrl: localDatabaseUrl,
    spawnProcess: (executable, args, options) => {
      captured.push({ executable, args, options });
      return {
        status: 1,
        stdout: "1..3\nApplying migration 202608260010_guard.sql\nok 1 - configured agent\nnot ok 2 - agent_policy_rls\n",
        stderr: "ERROR: SQLSTATE 42501 password=local-password host=127.0.0.1 token=super-secret-token",
      };
    },
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.failureCategory, "database_cli_failed");
  assert.equal(result.evidence.testCount, 3);
  assert.equal(result.evidence.failedTest, "test_2");
  assert.equal(result.evidence.failedTestNumber, 2);
  assert.equal(result.evidence.migration, "202608260010_guard.sql");
  assert.equal(result.evidence.errorSummary, "test_failed:42501");
  assert.doesNotMatch(JSON.stringify(result), /local-password|127\.0\.0\.1|super-secret-token|postgresql:/);
  assert.deepEqual(captured[0].options.stdio, ["ignore", "pipe", "pipe"]);
  const output = formatDbCommandResult("db:test", result);
  assert.match(output, /tests=3.*failed_test_number=2.*failed_test=test_2.*migration=202608260010_guard\.sql.*error=test_failed:42501/);
  assert.doesNotMatch(output, /local-password|127\.0\.0\.1|super-secret-token|postgresql:/);
});

test("never carries arbitrary libpq, Supabase, network, or credential text into database result evidence", async () => {
  const result = await runDbCommand({
    command: "db:test",
    environment: "Local",
    databaseUrl: localDatabaseUrl,
    spawnProcess: () => ({
      status: 1,
      stdout: "1..4\nApplying migration ../../secrets.sql\nnot ok 4 - https://db.prod.example/credentials?token=unknown-secret\n",
      stderr: [
        "psql: error: connection to server at \"203.0.113.9\", port 5432 failed: Connection refused",
        "connection to server at \"2001:db8::1\", port 5432 failed: password authentication failed for user \"intruder\" (SQLSTATE 28P01)",
        "Supabase CLI host='db.prod.example' token=unknown-secret untrusted_secret=opaque-value raw-token=A9B2C",
      ].join("\n"),
    }),
  });

  assert.deepEqual(result.evidence, {
    errorSummary: "auth_failed:28P01",
    failedTest: "test_4",
    failedTestNumber: 4,
    migration: undefined,
    testCount: 4,
  });
  const serialized = JSON.stringify(result);
  const cliOutput = formatDbCommandResult("db:test", result);
  for (const unsafeText of [
    "203.0.113.9",
    "2001:db8::1",
    "db.prod.example",
    "intruder",
    "unknown-secret",
    "opaque-value",
    "A9B2C",
    "https://",
    "secrets.sql",
  ]) {
    assert.equal(serialized.includes(unsafeText), false, `result must not contain ${unsafeText}`);
    assert.equal(cliOutput.includes(unsafeText), false, `CLI output must not contain ${unsafeText}`);
  }
});

test("does not treat generic code or token fields as a SQLSTATE", async () => {
  const result = await runDbCommand({
    command: "db:test",
    environment: "Local",
    databaseUrl: localDatabaseUrl,
    spawnProcess: () => ({
      status: 1,
      stdout: "1..1\nnot ok 1 - routine_name\n",
      stderr: "ERROR: access code=A9B2C token=code=Z9Y8X secret=unknown-secret",
    }),
  });

  assert.deepEqual(result.evidence, {
    errorSummary: "test_failed",
    failedTest: "test_1",
    failedTestNumber: 1,
    migration: undefined,
    testCount: 1,
  });
  const serialized = JSON.stringify(result);
  const output = formatDbCommandResult("db:test", result);
  for (const unsafeText of ["A9B2C", "Z9Y8X", "unknown-secret"]) {
    assert.equal(serialized.includes(unsafeText), false, `result must not contain ${unsafeText}`);
    assert.equal(output.includes(unsafeText), false, `CLI output must not contain ${unsafeText}`);
  }
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
    assert.doesNotMatch(packageJson.scripts[command], /postgres(?:ql)?:\/\//i);
  }
  for (const command of ["test:coverage", "test:security", "test:rls"]) {
    assert.match(packageJson.scripts[command], /scripts\/phase-gates\.mjs/);
  }
  assert.doesNotMatch(packageJson.scripts["test:rls"], /postgres(?:ql)?:\/\//i);
  assert.equal(packageJson.devDependencies["@vitest/coverage-v8"], "4.1.10");
  assert.equal(typeof packageJson.scripts["phase1:verify"], "string");
  for (const command of ["phase2:check", "phase2:dry-run", "phase2:push", "phase2:db-test", "phase2:verify"]) {
    assert.equal(typeof packageJson.scripts[command], "string", `${command} must be preserved`);
  }
  for (const command of ["phase2:check", "phase2:dry-run", "phase2:push", "phase2:db-test"]) {
    assert.match(packageJson.scripts[command], /scripts\/phase2\/supabase-command\.mjs/);
  }
  for (const command of ["test:unit", "test:watch"]) {
    assert.match(packageJson.scripts[command], /--exclude "scripts\/\*\*\/\*.test\.mjs"/);
    assert.doesNotMatch(packageJson.scripts[command], /scripts\/(?:phase1|phase2)\/\*\*\/\*.test\.mjs/);
  }
});
