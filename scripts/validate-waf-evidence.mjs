import { readFile } from "node:fs/promises";
import { createPublicKey, verify } from "node:crypto";
import { pathToFileURL } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;
const CANDIDATE = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[a-zA-Z0-9._:@-]{2,160}$/;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalWafEvidence(evidence) {
  const payload = { ...(evidence ?? {}) };
  delete payload.signature;
  return stable(payload);
}

function blocked(reason) {
  return { status: "BLOCKED", reason };
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateWafEvidence(
  evidence,
  { expectedCandidate, expectedConfigHash, publicKey } = {},
) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return blocked("evidence_missing");
  if (
    typeof evidence.provider !== "string" || !SAFE_ID.test(evidence.provider)
    || evidence.environment !== "staging"
    || typeof evidence.candidate !== "string" || !CANDIDATE.test(evidence.candidate)
    || typeof evidence.configHash !== "string" || !SHA256.test(evidence.configHash)
    || !evidence.operator || !SAFE_ID.test(evidence.operator.id ?? "")
    || evidence.operator.role !== "staging_owner"
    || !evidence.timestamps
    || !validTimestamp(evidence.timestamps.startedAt)
    || !validTimestamp(evidence.timestamps.completedAt)
    || Date.parse(evidence.timestamps.completedAt) < Date.parse(evidence.timestamps.startedAt)
    || !Array.isArray(evidence.rules) || evidence.rules.length === 0
    || evidence.rules.some((rule) => !rule || !SAFE_ID.test(rule.id ?? "") || !SAFE_ID.test(rule.action ?? ""))
    || !Array.isArray(evidence.results) || evidence.results.length !== evidence.rules.length
    || evidence.results.some((result) => !result || !SAFE_ID.test(result.ruleId ?? "") || result.outcome !== "passed")
  ) return blocked("evidence_incomplete");
  if (!expectedCandidate || evidence.candidate !== expectedCandidate) return blocked("candidate_mismatch");
  if (!expectedConfigHash || evidence.configHash !== expectedConfigHash) return blocked("config_hash_mismatch");
  const ruleIds = new Set(evidence.rules.map((rule) => rule.id));
  const resultIds = new Set(evidence.results.map((result) => result.ruleId));
  if (ruleIds.size !== evidence.rules.length || resultIds.size !== ruleIds.size
    || [...ruleIds].some((id) => !resultIds.has(id))) return blocked("result_scope_mismatch");
  const signature = evidence.signature;
  if (
    !signature || signature.algorithm !== "ed25519" || !SAFE_ID.test(signature.keyId ?? "")
    || typeof signature.value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature.value)
    || !publicKey
  ) return blocked("signature_missing");
  try {
    const verified = verify(
      null,
      Buffer.from(canonicalWafEvidence(evidence), "utf8"),
      createPublicKey(publicKey),
      Buffer.from(signature.value, "base64"),
    );
    return verified ? { status: "valid" } : blocked("signature_invalid");
  } catch {
    return blocked("signature_invalid");
  }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function runCli(argv = process.argv) {
  try {
    const evidencePath = argv[2];
    const publicKeyPath = option(argv, "--public-key");
    if (!evidencePath || !publicKeyPath) throw new Error("evidence_missing");
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    const publicKey = await readFile(publicKeyPath, "utf8");
    const result = validateWafEvidence(evidence, {
      expectedCandidate: option(argv, "--candidate"),
      expectedConfigHash: option(argv, "--config-hash"),
      publicKey,
    });
    console.log(`${result.status} waf_evidence${result.reason ? ` reason=${result.reason}` : ""}`);
    if (result.status !== "valid") process.exitCode = 1;
  } catch {
    console.error("BLOCKED waf_evidence reason=evidence_missing");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
