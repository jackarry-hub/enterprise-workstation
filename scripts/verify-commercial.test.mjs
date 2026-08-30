import assert from "node:assert/strict";
import { test } from "node:test";

import { runDbCommand } from "./db-command-runner.mjs";
import { verifyCommercial } from "./verify-commercial-evidence.mjs";
import { COMMERCIAL_LOCAL_STEPS, runCommercialLocal } from "./verify-commercial-local.mjs";
import { verifyCommercialStaging } from "./verify-commercial-staging.mjs";

test("database runner rejects Internal destructive or verifier commands before process execution", async () => {
  await assert.rejects(() => runDbCommand({ environment: "internal", command: "db:reset:test", databaseUrl: "postgresql://example.invalid/db" }), /environment_mutation_forbidden/);
});

test("Staging verification is blocked without explicit external evidence inputs", async () => {
  assert.deepEqual(await verifyCommercialStaging({ manifestPath: "", artifactRoot: "", publicKeyPath: "", expectedCommit: "" }), { status: "BLOCKED", issues: ["authorized_staging_inputs_missing"] });
});

test("final verification blocks fused assets, unready modules and missing Staging evidence", async () => {
  const report = await verifyCommercial({ fusedPresent: true, unreadyModules: ["tasks"], stagingStatus: "BLOCKED" });
  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.issues, ["fused_assets_present", "commercial_modules_unready:tasks", "authorized_staging_evidence_missing"]);
});

test("final verification passes only after every independent gate is closed", async () => {
  assert.deepEqual(await verifyCommercial({ fusedPresent: false, unreadyModules: [], stagingStatus: "PASSED" }), { status: "PASSED", issues: [] });
});

test("local verification is explicit static evidence and preserves ordered fail-fast steps", async () => {
  const observed = [];
  const report = await runCommercialLocal({ runStep: async (step) => observed.push(step) });
  assert.deepEqual(observed, COMMERCIAL_LOCAL_STEPS);
  assert.equal(report.status, "LOCAL_STATIC_PASS");
  assert.match(report.claim, /pending_authorized_staging/);
});

