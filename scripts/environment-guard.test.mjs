import assert from "node:assert/strict";
import test from "node:test";

import {
  EnvironmentFingerprint,
  assertSafeDatabaseTarget,
} from "./environment-guard.mjs";

const localDatabaseUrl = "postgresql://postgres:local-password@127.0.0.1:54322/postgres";

test("accepts an explicitly marked Local command only for the isolated loopback Supabase database", () => {
  const fingerprint = assertSafeDatabaseTarget({
    command: "db:reset:test",
    environment: "Local",
    databaseUrl: localDatabaseUrl,
  });

  assert.ok(fingerprint instanceof EnvironmentFingerprint);
  assert.deepEqual(fingerprint.toJSON(), {
    command: "db:reset:test",
    environment: "Local",
    target: "local_supabase_postgres",
  });
});

test("rejects unknown, Internal, and Customer Production before any database connection", () => {
  for (const environment of ["unknown", "Internal", "Customer Production"]) {
    assert.throws(
      () => assertSafeDatabaseTarget({
        command: "db:test",
        environment,
        databaseUrl: localDatabaseUrl,
      }),
      /environment_mutation_forbidden/,
    );
  }
});

test("rejects a spoofed Local marker paired with a remote or production-like URL", () => {
  for (const databaseUrl of [
    "https://prod.example",
    "postgresql://postgres:password@db.production.example:5432/postgres",
  ]) {
    assert.throws(
      () => assertSafeDatabaseTarget({
        command: "db:reset:test",
        environment: "local",
        databaseUrl,
      }),
      /environment_mutation_forbidden/,
    );
  }
});

test("allows Staging only for the explicit non-destructive migration dry run", () => {
  const stagingDatabaseUrl = "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/postgres";
  const previousHost = process.env.QUANTXY_STAGING_DATABASE_HOST;
  process.env.QUANTXY_STAGING_DATABASE_HOST = "db.abcxyz.supabase.co";
  try {
    const fingerprint = assertSafeDatabaseTarget({
      command: "db:migrate:dry-run",
      environment: "Staging",
      databaseUrl: stagingDatabaseUrl,
    });

    assert.deepEqual(fingerprint.toJSON(), {
      command: "db:migrate:dry-run",
      environment: "Staging",
      target: "staging_postgres",
    });
    for (const command of ["db:reset:test", "db:seed:validate", "db:rollback:test", "db:test"]) {
      assert.throws(
        () => assertSafeDatabaseTarget({ command, environment: "Staging", databaseUrl: stagingDatabaseUrl }),
        /environment_mutation_forbidden/,
      );
    }
  } finally {
    if (previousHost === undefined) delete process.env.QUANTXY_STAGING_DATABASE_HOST;
    else process.env.QUANTXY_STAGING_DATABASE_HOST = previousHost;
  }
});

test("rejects Staging when the server-only database host fingerprint is missing or mismatched", () => {
  const stagingDatabaseUrl = "postgresql://sensitive-user:top-secret-password@db.abcxyz.supabase.co:5432/postgres";
  const previousHost = process.env.QUANTXY_STAGING_DATABASE_HOST;
  try {
    delete process.env.QUANTXY_STAGING_DATABASE_HOST;
    assert.throws(
      () => assertSafeDatabaseTarget({ command: "db:migrate:dry-run", environment: "Staging", databaseUrl: stagingDatabaseUrl }),
      /environment_mutation_forbidden/,
    );

    process.env.QUANTXY_STAGING_DATABASE_HOST = "db.different.supabase.co";
    assert.throws(
      () => assertSafeDatabaseTarget({ command: "db:migrate:dry-run", environment: "Staging", databaseUrl: stagingDatabaseUrl }),
      (error) => {
        assert.match(error.message, /environment_mutation_forbidden/);
        assert.doesNotMatch(error.message, /sensitive-user|top-secret-password|abcxyz/);
        return true;
      },
    );
  } finally {
    if (previousHost === undefined) delete process.env.QUANTXY_STAGING_DATABASE_HOST;
    else process.env.QUANTXY_STAGING_DATABASE_HOST = previousHost;
  }
});

test("never puts a database username or password in a rejection error", () => {
  const databaseUrl = "postgresql://sensitive-user:top-secret-password@prod.example:5432/postgres";

  assert.throws(
    () => assertSafeDatabaseTarget({ command: "db:reset:test", environment: "Local", databaseUrl }),
    (error) => {
      assert.match(error.message, /environment_mutation_forbidden/);
      assert.doesNotMatch(error.message, /sensitive-user|top-secret-password|prod\.example/);
      return true;
    },
  );
});
