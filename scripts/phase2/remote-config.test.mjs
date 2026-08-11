import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeRemoteConfig,
  validateRemoteConfig,
} from "./remote-config.mjs";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcxyz.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_server_only",
  SUPABASE_DB_URL:
    "postgresql://postgres:password@db.abcxyz.supabase.co:5432/postgres",
};

test("accepts a complete hosted Supabase configuration", () => {
  assert.equal(validateRemoteConfig(valid).projectRef, "abcxyz");
});

test("accepts a same-project session pooler connection", () => {
  const config = validateRemoteConfig({
    ...valid,
    SUPABASE_DB_URL:
      "postgresql://postgres.abcxyz:password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
  });

  assert.equal(config.projectRef, "abcxyz");
});

test("normalizes reserved characters in the database password", () => {
  const config = validateRemoteConfig({
    ...valid,
    SUPABASE_DB_URL:
      "postgresql://postgres.abcxyz:p@ss:word@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
  });

  assert.equal(
    config.dbUrl,
    "postgresql://postgres.abcxyz:p%40ss%3Aword@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
  );
});

test("reports every missing remote setting", () => {
  assert.throws(
    () =>
      validateRemoteConfig({
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        SUPABASE_DB_URL: "",
      }),
    /NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL/,
  );
});

test("rejects a secret key placed in the public key field", () => {
  assert.throws(
    () =>
      validateRemoteConfig({
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: valid.SUPABASE_SERVICE_ROLE_KEY,
      }),
    /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
  );
});

test("rejects a public key placed in the service key field", () => {
  assert.throws(
    () =>
      validateRemoteConfig({
        ...valid,
        SUPABASE_SERVICE_ROLE_KEY: valid.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
});

test("rejects a database connection for another Supabase project", () => {
  assert.throws(
    () =>
      validateRemoteConfig({
        ...valid,
        SUPABASE_DB_URL:
          "postgresql://postgres:password@db.other.supabase.co:5432/postgres",
      }),
    /SUPABASE_DB_URL/,
  );
});

test("rejects a session pooler connection for another project", () => {
  assert.throws(
    () =>
      validateRemoteConfig({
        ...valid,
        SUPABASE_DB_URL:
          "postgresql://postgres.other:password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
      }),
    /SUPABASE_DB_URL/,
  );
});

test("rejects a REST endpoint where the project base URL is required", () => {
  assert.throws(
    () =>
      validateRemoteConfig({
        ...valid,
        NEXT_PUBLIC_SUPABASE_URL: "https://abcxyz.supabase.co/rest/v1",
      }),
    /NEXT_PUBLIC_SUPABASE_URL/,
  );
});

test("rejects an unreplaced database password placeholder", () => {
  assert.throws(
    () =>
      validateRemoteConfig({
        ...valid,
        SUPABASE_DB_URL:
          "postgresql://postgres:[YOUR-PASSWORD]@db.abcxyz.supabase.co:5432/postgres",
      }),
    /SUPABASE_DB_URL/,
  );
});

test("produces a summary that contains no key or password", () => {
  const summary = JSON.stringify(
    summarizeRemoteConfig(validateRemoteConfig(valid)),
  );

  assert.equal(summary.includes("sb_publishable_public"), false);
  assert.equal(summary.includes("sb_secret_server_only"), false);
  assert.equal(summary.includes("password"), false);
  assert.match(summary, /abcxyz/);
});
