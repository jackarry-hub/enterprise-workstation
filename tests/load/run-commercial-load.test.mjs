import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCommercialThresholds, validateCommercialLoadResult } from "./run-commercial-load.mjs";

const thresholds = parseCommercialThresholds(`
seededStaff: 100
activeUsers: 50
concurrentWrites: 20
queuedAiAgentJobs: 10
nonAiP95MsMax: 800
errorRateMaxExclusive: 0.005
mobileInteractiveMsMax: 3000
`);

const passing = {
  seededStaff: 100,
  activeUsers: 50,
  concurrentWrites: 20,
  queuedAiAgentJobs: 10,
  nonAiP95Ms: 800,
  errorRate: 0.0049,
  mobileInteractiveMs: 3000,
  environment: "Staging",
  candidateCommit: "a".repeat(40),
  measuredAt: "2026-08-30T00:00:00.000Z",
};

test("accepts the exact commercial load profile at permitted limits", () => {
  assert.deepEqual(validateCommercialLoadResult(passing, thresholds), []);
});

test("rejects reduced concurrency, threshold equality for error rate, and non-Staging evidence", () => {
  const issues = validateCommercialLoadResult({
    ...passing,
    activeUsers: 49,
    errorRate: 0.005,
    environment: "Production",
  }, thresholds);
  assert.deepEqual(issues.sort(), ["activeUsers_mismatch", "error_rate_exceeded", "staging_environment_required"].sort());
});

