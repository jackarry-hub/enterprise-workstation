import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { parseEnv, prepareStagingEnvironment, upsertEnv } from "./prepare-staging-env.mjs";

test("upsertEnv preserves existing lines and appends missing keys", () => {
  const output = upsertEnv("A=old\n# comment\n", { A: "new", B: "value" });
  assert.match(output, /^A=new\n# comment\n/);
  assert.match(output, /\nB=value\n$/);
});

test("parseEnv rejects duplicate active keys", () => {
  assert.throws(() => parseEnv("A=one\nA=two\n"), /duplicate_environment_key:A/);
});

test("prepareStagingEnvironment copies Feishu values and generates distinct secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "quantxy-staging-env-"));
  try {
    writeFileSync(resolve(root, ".env.local"), [
      "FEISHU_TENANT_KEY=tenant-real",
      "FEISHU_APP_ID=cli_real",
      "FEISHU_APP_SECRET=server-secret",
    ].join("\n"));
    writeFileSync(resolve(root, ".env.staging.local"), "NEXT_PUBLIC_APP_URL=https://staging.example\nNEXT_PUBLIC_SUPABASE_URL=https://project.supabase.co\n");
    const candidate = "a".repeat(40);
    prepareStagingEnvironment(root, candidate);
    const values = parseEnv(readFileSync(resolve(root, ".env.staging.local"), "utf8"));
    assert.equal(values.get("FEISHU_APP_ID"), "cli_real");
    assert.equal(Buffer.from(values.get("AI_CONFIG_ENCRYPTION_KEY"), "base64").length, 32);
    assert.ok(values.get("INTERNAL_WORKER_TOKEN").length >= 32);
    assert.notEqual(values.get("INTERNAL_WORKER_TOKEN"), values.get("RATE_LIMIT_HASH_PEPPER"));
    assert.equal(values.get("QUANTXY_EDGE_ALIAS"), "quantxy-staging-workstation");
    assert.equal(values.get("KNOWLEDGE_PROCESSOR_URL"), "https://staging.example/api/internal/knowledge-processor");
    assert.equal(values.get("KNOWLEDGE_SOURCE_ALLOWED_HOSTS"), "project.supabase.co");
    assert.equal(values.get("QUANTXY_IMAGE_TAG"), candidate);
    assert.equal(values.get("QUANTXY_RELEASE_CANDIDATE_COMMIT"), candidate);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
