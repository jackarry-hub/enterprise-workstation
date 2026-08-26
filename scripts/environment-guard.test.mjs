import assert from "node:assert/strict";
import test from "node:test";

import {
  EnvironmentFingerprint,
  assertSafeDatabaseTarget,
} from "./environment-guard.mjs";

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
  const stagingDatabaseUrl = "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/postgres?sslmode=require";
  const restore = installStagingFingerprint();
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
    restore();
  }
});

test("rejects Staging when the server-only database host fingerprint is missing or mismatched", () => {
  const stagingDatabaseUrl = "postgresql://sensitive-user:top-secret-password@db.abcxyz.supabase.co:5432/postgres?sslmode=require";
  const restore = installStagingFingerprint();
  try {
    for (const key of [
      "QUANTXY_STAGING_DATABASE_HOST",
      "QUANTXY_STAGING_DATABASE_PORT",
      "QUANTXY_STAGING_DATABASE_NAME",
      "QUANTXY_STAGING_DATABASE_USER",
      "QUANTXY_STAGING_DATABASE_SSLMODE",
    ]) {
      const configuredValue = process.env[key];
      delete process.env[key];
      assert.throws(
        () => assertSafeDatabaseTarget({ command: "db:migrate:dry-run", environment: "Staging", databaseUrl: stagingDatabaseUrl }),
        /environment_mutation_forbidden/,
      );
      process.env[key] = configuredValue;
    }

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
    restore();
  }
});

test("rejects every PostgreSQL routing query, fragment, and multi-host form before a local connection can be opened", () => {
  for (const databaseUrl of [
    "postgresql://postgres:local-password@127.0.0.1:54322/postgres?host=prod.example&port=5432",
    "postgresql://postgres:local-password@127.0.0.1:54322/postgres?hostaddr=203.0.113.9",
    "postgresql://postgres:local-password@127.0.0.1:54322/postgres?dbname=production",
    "postgresql://postgres:local-password@127.0.0.1:54322/postgres?service=prod",
    "postgresql://postgres:local-password@127.0.0.1:54322/postgres?servicefile=%2Ftmp%2Fservice",
    "postgresql://postgres:local-password@127.0.0.1:54322/postgres?options=-c%20search_path%3Dprod",
    "postgresql://postgres:local-password@127.0.0.1:54322/postgres?%68ost=prod.example",
    "postgresql://postgres:local-password@127.0.0.1:54322/postgres?sslmode=require&sslmode=require",
    "postgresql://postgres:local-password@127.0.0.1:54322/postgres#ignored",
    "postgresql://postgres:local-password@127.0.0.1,db.prod.example:54322/postgres",
  ]) {
    assert.throws(
      () => assertSafeDatabaseTarget({ command: "db:test", environment: "Local", databaseUrl }),
      /environment_mutation_forbidden/,
    );
  }
});

test("requires the complete local connection tuple instead of trusting only a loopback host and port", () => {
  for (const databaseUrl of [
    "postgresql://other-user:local-password@127.0.0.1:54322/postgres",
    "postgresql://postgres:local-password@127.0.0.1:54322/other_database",
    "postgresql://postgres:local-password@127.0.0.1:5432/postgres",
  ]) {
    assert.throws(
      () => assertSafeDatabaseTarget({ command: "db:test", environment: "CI/Test", databaseUrl }),
      /environment_mutation_forbidden/,
    );
  }
});

test("requires an exact Staging tuple and exactly one configured TLS query parameter", () => {
  const restore = installStagingFingerprint();
  try {
    const valid = "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/postgres?sslmode=require";
    assert.equal(
      assertSafeDatabaseTarget({ command: "db:migrate:dry-run", environment: "Staging", databaseUrl: valid }).toJSON().target,
      "staging_postgres",
    );
    for (const databaseUrl of [
      "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5433/postgres?sslmode=require",
      "postgresql://other-user:staging-password@db.abcxyz.supabase.co:5432/postgres?sslmode=require",
      "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/other?sslmode=require",
      "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/postgres?sslmode=disable",
      "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/postgres",
      "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/postgres?sslmode=require&sslmode=require",
      "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/postgres?ssl%6dode=require",
      "postgresql://postgres:staging-password@db.abcxyz.supabase.co:5432/postgres?host=prod.example&sslmode=require",
    ]) {
      assert.throws(
        () => assertSafeDatabaseTarget({ command: "db:migrate:dry-run", environment: "Staging", databaseUrl }),
        /environment_mutation_forbidden/,
      );
    }
  } finally {
    restore();
  }
});

test("never accepts a loopback or local hostname as a Staging fingerprint", () => {
  const restore = installStagingFingerprint();
  try {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      process.env.QUANTXY_STAGING_DATABASE_HOST = host;
      const databaseUrl = `postgresql://postgres:staging-password@${host === "[::1]" ? host : host}:5432/postgres?sslmode=require`;
      assert.throws(
        () => assertSafeDatabaseTarget({ command: "db:migrate:dry-run", environment: "Staging", databaseUrl }),
        /environment_mutation_forbidden/,
      );
    }
  } finally {
    restore();
  }
});

test("rejects every command outside the canonical database command set before environment handling", () => {
  for (const command of ["unknown", "constructor", "toString", "__proto__"]) {
    assert.throws(
      () => assertSafeDatabaseTarget({ command, environment: "Local", databaseUrl: localDatabaseUrl }),
      /database_command_forbidden/,
    );
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
