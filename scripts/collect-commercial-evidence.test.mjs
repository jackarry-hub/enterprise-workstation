import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectCommercialEvidence } from "./collect-commercial-evidence.mjs";

test("collects candidate, migration hashes, zero-failure counts and safe artifact paths", async (context) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "quantxy-evidence-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(path.join(rootDir, "supabase", "migrations"), { recursive: true });
  await mkdir(path.join(rootDir, "tests", "e2e"), { recursive: true });
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: { "verify:commercial:preflight": "node gate" } }));
  await writeFile(path.join(rootDir, "playwright.config.ts"), "workers: 1; quantxy-commercial-playwright-results.json");
  await writeFile(path.join(rootDir, "tests", "e2e", "commercial-journeys.spec.ts"), [
    "/people", "/projects", "/tasks", "/customers", "/approvals", "/payroll",
    "/knowledge", "/assistant", "/agents", "/analytics", "/settings",
  ].map((route) => JSON.stringify(route)).join("\n"));
  await writeFile(path.join(rootDir, "supabase", "migrations", "202608300001_test.sql"), "select 1;");
  const resultsPath = path.join(rootDir, "results.json");
  await writeFile(resultsPath, JSON.stringify({
    stats: { startTime: "2026-08-30T12:00:00.000Z", duration: 1000, expected: 7, unexpected: 0, skipped: 1, flaky: 0 },
    suites: [{ specs: [{ tests: [{ results: [{ attachments: [{ path: "test-results/journey/trace.zip" }] }] }] }] }],
  }));
  const manifest = await collectCommercialEvidence({
    rootDir,
    resultsPath,
    commit: "a".repeat(40),
    scanReport: { status: "PASS" },
  });
  assert.equal(manifest.failed, 0);
  assert.equal(manifest.passed, 7);
  assert.equal(manifest.migrations.length, 1);
  assert.match(manifest.migrations[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(manifest.artifactPaths, ["test-results/journey/trace.zip"]);
  assert.equal(manifest.commercialVerification, "BLOCKED_PENDING_AUTHORIZED_STAGING");
});

test("fails closed before collection when the harness or result input is unavailable", async () => {
  await assert.rejects(
    collectCommercialEvidence({ rootDir: "missing", resultsPath: "missing" }),
  );
});
