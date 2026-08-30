import assert from "node:assert/strict";
import { test } from "node:test";

import { REQUIRED_STAGING_EVIDENCE, assertFusedRetirementEvidence, verifyExternalReleaseManifest } from "./verify-commercial-evidence.mjs";

function manifest() {
  return {
    schemaVersion: 1,
    environment: "Staging",
    candidateCommit: "a".repeat(40),
    candidateTreeSha256: "b".repeat(64),
    configSha256: "c".repeat(64),
    migrationSha256: "d".repeat(64),
    authorization: { id: "approval-1", candidateCommit: "a".repeat(40), approvedAt: "2026-08-30T00:00:00.000Z" },
    metrics: { rpoHours: 1, rtoHours: 2, seededStaff: 100, activeUsers: 50, concurrentWrites: 20, queuedAiAgentJobs: 10, nonAiP95Ms: 500, errorRate: 0.001, mobileInteractiveMs: 2000 },
    evidence: REQUIRED_STAGING_EVIDENCE.map((type) => ({ type, path: `${type}.json`, sha256: "e".repeat(64), status: "PASSED", measuredAt: "2026-08-30T01:00:00.000Z" })),
    signature: { algorithm: "Ed25519", value: Buffer.from("signature").toString("base64") },
  };
}

test("accepts complete hash-bound Staging evidence when the Ed25519 verifier succeeds", async () => {
  const report = await verifyExternalReleaseManifest({ manifest: manifest(), expectedCommit: "a".repeat(40), publicKeyPem: "public-key", verifySignature: () => true });
  assert.deepEqual(report, { status: "PASSED", issues: [] });
});

test("rejects missing evidence, mismatched candidate, and an invalid signature", async () => {
  const candidate = manifest();
  candidate.evidence = candidate.evidence.slice(1);
  const report = await verifyExternalReleaseManifest({ manifest: candidate, expectedCommit: "f".repeat(40), publicKeyPem: "public-key", verifySignature: () => false });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.issues.includes("candidate_commit_mismatch"));
  assert.ok(report.issues.some((issue) => issue.startsWith("evidence_missing:")));
  assert.ok(report.issues.includes("signature_invalid"));
});

test("blocks fused retirement without exact authorization, canary, parity, rollback and tree digest", () => {
  assert.equal(assertFusedRetirementEvidence({ authorization: null }).status, "BLOCKED");
  assert.equal(assertFusedRetirementEvidence({ authorization: { status: "APPROVED" }, canary: "failed" }).status, "BLOCKED");
  assert.equal(assertFusedRetirementEvidence({ authorization: { status: "APPROVED" }, canary: "passed", parity: "passed", rollback: "passed", prospectiveTreeHash: "a".repeat(64), stagingTreeHash: "b".repeat(64) }).status, "BLOCKED");
});

