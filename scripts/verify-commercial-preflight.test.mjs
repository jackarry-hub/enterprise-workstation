import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMMERCIAL_PREFLIGHT_STEPS,
  formatPreflightFailure,
  runCommercialPreflight,
  scanTrackedSecrets,
} from "./verify-commercial-preflight.mjs";

const EXPECTED_STEPS = [
  "npm-ci",
  "db-migrate-dry-run",
  "typecheck",
  "lint",
  "build",
  "unit",
  "coverage",
  "db-test-pgtap-rls",
  "integration",
  "desktop-e2e",
  "emulated-mobile-e2e",
  "a11y",
  "dependency-scan",
  "secret-scan",
];

test("commercial preflight exposes only the exact ordered preliminary gate", async () => {
  assert.deepEqual([...COMMERCIAL_PREFLIGHT_STEPS], EXPECTED_STEPS);
  const called = [];
  const report = await runCommercialPreflight({
    runStep: async (step) => called.push(step),
  });
  assert.deepEqual(called, EXPECTED_STEPS);
  assert.equal(report.status, "PREFLIGHT_PASS");
  assert.equal(report.claim, "preliminary_only");
});

test("preflight stops after the first failed command", async () => {
  const called = [];
  await assert.rejects(
    runCommercialPreflight({
      runStep: async (step) => {
        called.push(step);
        if (step === "build") {
          const error = new Error("untrusted command output");
          error.step = step;
          throw error;
        }
      },
    }),
    /untrusted command output/,
  );
  assert.deepEqual(called, EXPECTED_STEPS.slice(0, EXPECTED_STEPS.indexOf("build") + 1));
});

test("failure reporting emits only an allowlisted step and category", () => {
  assert.equal(
    formatPreflightFailure({
      step: "build",
      category: "credential=https://user:secret@example.invalid",
      message: "raw secret",
    }),
    "BLOCKED commercial_preflight step=build category=command_failed",
  );
});

test("tracked secret scan reports safe file and type metadata without returning the value", async () => {
  const value = `sk-proj-${"A".repeat(40)}`;
  const violations = await scanTrackedSecrets({
    rootDir: "fixture",
    spawnProcess: () => ({ status: 0, stdout: "src/config.ts\0" }),
    readFileImpl: async () => `export const credential = ${JSON.stringify(value)};`,
  });
  assert.deepEqual(violations, [{ file: "src/config.ts", type: "openai_key" }]);
  assert.equal(JSON.stringify(violations).includes(value), false);
});

test("tracked environment and private-key artifacts fail closed", async () => {
  const violations = await scanTrackedSecrets({
    rootDir: "fixture",
    spawnProcess: () => ({ status: 0, stdout: ".env.local\0certs/client.key\0.env.example\0" }),
    readFileImpl: async () => "placeholder",
  });
  assert.deepEqual(violations, [
    { file: ".env.local", type: "sensitive_file" },
    { file: "certs/client.key", type: "sensitive_file" },
  ]);
});

test("CI uses an isolated local Supabase gate and never requests production secrets", async () => {
  const workflow = await readFile(".github/workflows/commercial-ci.yml", "utf8");
  assert.match(workflow, /node-version:\s*["']22\.x["']/);
  assert.match(workflow, /cache:\s*["']npm["']/);
  assert.match(workflow, /supabase start/);
  assert.match(workflow, /npm run verify:commercial:preflight/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /enterprise-workstation-playwright/);
  assert.doesNotMatch(workflow, /secrets\.|pull_request_target|environment:\s*(production|internal)/i);
});

test("package exposes only the preliminary Task 3 verifier alias", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(
    packageJson.scripts["verify:commercial:preflight"],
    "node scripts/verify-commercial-preflight.mjs",
  );
  assert.equal(packageJson.scripts["verify:commercial"], undefined);
  assert.equal(packageJson.scripts["verify:commercial:staging"], undefined);
});
