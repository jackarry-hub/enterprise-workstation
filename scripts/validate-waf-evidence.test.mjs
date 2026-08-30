import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  canonicalWafEvidence,
  validateWafEvidence,
} from "./validate-waf-evidence.mjs";

const candidate = "a".repeat(40);
const configHash = "b".repeat(64);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" });

function signedEvidence() {
  const evidence = {
    provider: "cloud-waf",
    rules: [
      { id: "managed-common", action: "block" },
      { id: "login-rate-limit", action: "challenge" },
    ],
    environment: "staging",
    candidate,
    operator: { id: "staging-owner-01", role: "staging_owner" },
    timestamps: {
      startedAt: "2026-08-30T12:00:00.000Z",
      completedAt: "2026-08-30T12:10:00.000Z",
    },
    results: [
      { ruleId: "managed-common", outcome: "passed", statusCode: 403 },
      { ruleId: "login-rate-limit", outcome: "passed", statusCode: 429 },
    ],
    configHash,
    signature: { algorithm: "ed25519", keyId: "staging-owner-key-01", value: "pending" },
  };
  evidence.signature.value = sign(
    null,
    Buffer.from(canonicalWafEvidence(evidence), "utf8"),
    privateKey,
  ).toString("base64");
  return evidence;
}

test("accepts complete candidate-bound WAF evidence signed by the Staging owner", () => {
  assert.deepEqual(
    validateWafEvidence(signedEvidence(), { expectedCandidate: candidate, expectedConfigHash: configHash, publicKey: publicPem }),
    { status: "valid" },
  );
});

test("blocks missing, incomplete and unsigned evidence", () => {
  assert.equal(validateWafEvidence(null).status, "BLOCKED");
  const unsigned = signedEvidence();
  delete unsigned.signature;
  assert.deepEqual(
    validateWafEvidence(unsigned, { expectedCandidate: candidate, expectedConfigHash: configHash, publicKey: publicPem }),
    { status: "BLOCKED", reason: "signature_missing" },
  );
});

test("blocks candidate and config-hash mismatches before release", () => {
  const evidence = signedEvidence();
  assert.deepEqual(
    validateWafEvidence(evidence, { expectedCandidate: "c".repeat(40), expectedConfigHash: configHash, publicKey: publicPem }),
    { status: "BLOCKED", reason: "candidate_mismatch" },
  );
  assert.deepEqual(
    validateWafEvidence(evidence, { expectedCandidate: candidate, expectedConfigHash: "d".repeat(64), publicKey: publicPem }),
    { status: "BLOCKED", reason: "config_hash_mismatch" },
  );
});

test("blocks tampered results and signatures", () => {
  const evidence = signedEvidence();
  evidence.results[0].statusCode = 200;
  assert.deepEqual(
    validateWafEvidence(evidence, { expectedCandidate: candidate, expectedConfigHash: configHash, publicKey: publicPem }),
    { status: "BLOCKED", reason: "signature_invalid" },
  );
});
