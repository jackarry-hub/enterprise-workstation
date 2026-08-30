import { createHash, verify as verifyCryptoSignature } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_STAGING_EVIDENCE = Object.freeze([
  "database-reset-rls",
  "integration",
  "desktop-e2e",
  "mobile-emulation-e2e",
  "real-device-ios",
  "real-device-android",
  "feishu-oauth-events",
  "deepseek-success-failure",
  "storage-byte-verification",
  "security-waf",
  "commercial-load",
  "backup-restore",
  "canary",
  "observation-7d",
  "handoff-training",
]);

const FUSED_ASSETS = Object.freeze([
  "src/app/quantxy-ai-workbench-fused.html/route.ts",
  "src/app/quantxy-ai-workbench-fused.html/route-support.ts",
  "quantxy-ai-workbench-fused.html",
  "public/workstation-server-adapter.js",
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeRelativeArtifact(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 240
    && !path.isAbsolute(value)
    && !value.replaceAll("\\", "/").split("/").includes("..")
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function signaturePayload(manifest) {
  const { signature: _signature, ...unsigned } = manifest;
  return Buffer.from(canonicalJson(unsigned), "utf8");
}

export async function verifyExternalReleaseManifest({
  manifest,
  expectedCommit,
  artifactRoot,
  publicKeyPem,
  verifySignature = (payload, signature, publicKey) => verifyCryptoSignature(null, payload, publicKey, signature),
} = {}) {
  const issues = [];
  if (!manifest || manifest.schemaVersion !== 1 || manifest.environment !== "Staging") issues.push("manifest_identity_invalid");
  if (!/^[0-9a-f]{40}$/.test(manifest?.candidateCommit ?? "") || manifest?.candidateCommit !== expectedCommit) {
    issues.push("candidate_commit_mismatch");
  }
  for (const key of ["configSha256", "migrationSha256", "candidateTreeSha256"]) {
    if (!/^[0-9a-f]{64}$/.test(manifest?.[key] ?? "")) issues.push(`${key}_invalid`);
  }
  const authorization = manifest?.authorization;
  if (!authorization || typeof authorization.id !== "string" || authorization.id.trim() === ""
    || authorization.candidateCommit !== expectedCommit
    || !Number.isFinite(Date.parse(authorization.approvedAt ?? ""))) issues.push("authorization_invalid");

  const metrics = manifest?.metrics ?? {};
  if (!(metrics.rpoHours >= 0 && metrics.rpoHours <= 24)) issues.push("rpo_exceeded");
  if (!(metrics.rtoHours >= 0 && metrics.rtoHours <= 4)) issues.push("rto_exceeded");
  if (!(metrics.nonAiP95Ms >= 0 && metrics.nonAiP95Ms <= 800)) issues.push("non_ai_p95_exceeded");
  if (!(metrics.errorRate >= 0 && metrics.errorRate < 0.005)) issues.push("error_rate_exceeded");
  if (!(metrics.mobileInteractiveMs >= 0 && metrics.mobileInteractiveMs <= 3000)) issues.push("mobile_interactive_exceeded");
  for (const [key, expected] of [["seededStaff", 100], ["activeUsers", 50], ["concurrentWrites", 20], ["queuedAiAgentJobs", 10]]) {
    if (metrics[key] !== expected) issues.push(`${key}_mismatch`);
  }

  const evidence = Array.isArray(manifest?.evidence) ? manifest.evidence : [];
  const types = new Set(evidence.filter((item) => item?.status === "PASSED").map((item) => item.type));
  for (const type of REQUIRED_STAGING_EVIDENCE) if (!types.has(type)) issues.push(`evidence_missing:${type}`);
  const seenPaths = new Set();
  for (const item of evidence) {
    if (!safeRelativeArtifact(item?.path) || !/^[0-9a-f]{64}$/.test(item?.sha256 ?? "")
      || item?.status !== "PASSED" || !Number.isFinite(Date.parse(item?.measuredAt ?? ""))) {
      issues.push(`evidence_invalid:${typeof item?.type === "string" ? item.type : "unknown"}`);
      continue;
    }
    if (seenPaths.has(item.path)) issues.push(`evidence_path_duplicate:${item.path}`);
    seenPaths.add(item.path);
    if (artifactRoot) {
      try {
        const bytes = await readFile(path.join(artifactRoot, item.path));
        if (sha256(bytes) !== item.sha256) issues.push(`evidence_checksum_mismatch:${item.type}`);
      } catch {
        issues.push(`evidence_unreadable:${item.type}`);
      }
    }
  }

  if (!publicKeyPem || manifest?.signature?.algorithm !== "Ed25519"
    || typeof manifest?.signature?.value !== "string") {
    issues.push("signature_missing");
  } else {
    try {
      const signature = Buffer.from(manifest.signature.value, "base64");
      if (!verifySignature(signaturePayload(manifest), signature, publicKeyPem)) issues.push("signature_invalid");
    } catch {
      issues.push("signature_invalid");
    }
  }
  return { status: issues.length ? "BLOCKED" : "PASSED", issues };
}

export function assertFusedRetirementEvidence({
  authorization,
  canary,
  prospectiveTreeHash,
  stagingTreeHash,
  parity,
  rollback,
} = {}) {
  const validDigest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const issues = [];
  if (!authorization || authorization.status !== "APPROVED") issues.push("retirement_authorization_missing");
  if (canary !== "passed") issues.push("canary_not_passed");
  if (parity !== "passed") issues.push("parity_not_passed");
  if (rollback !== "passed") issues.push("rollback_not_passed");
  if (!validDigest(prospectiveTreeHash) || prospectiveTreeHash !== stagingTreeHash) issues.push("prospective_tree_mismatch");
  return { status: issues.length ? "BLOCKED" : "PASSED", issues };
}

async function defaultFusedPresence(rootDir) {
  for (const relativePath of FUSED_ASSETS) {
    try {
      await access(path.join(rootDir, relativePath));
      return true;
    } catch {}
  }
  return false;
}

async function defaultUnreadyModules(rootDir) {
  const source = await readFile(path.join(rootDir, "src", "features", "commercial", "module-capabilities.ts"), "utf8");
  return [...source.matchAll(/^\s*([a-z_]+):\s*\{[^\n]+commercialReady:\s*false/gm)].map((match) => match[1]);
}

export async function verifyCommercial({
  rootDir = process.cwd(),
  fusedPresent,
  unreadyModules,
  stagingStatus,
} = {}) {
  const fused = fusedPresent ?? await defaultFusedPresence(rootDir);
  const unready = unreadyModules ?? await defaultUnreadyModules(rootDir);
  const issues = [];
  if (fused) issues.push("fused_assets_present");
  if (unready.length) issues.push(`commercial_modules_unready:${unready.join(",")}`);
  if (stagingStatus !== "PASSED") issues.push("authorized_staging_evidence_missing");
  return { status: issues.length ? "BLOCKED" : "PASSED", issues };
}

async function runFinalCli() {
  const report = await verifyCommercial({ stagingStatus: process.env.QUANTXY_STAGING_EVIDENCE_STATUS });
  if (report.status !== "PASSED") {
    console.error(`BLOCKED commercial_evidence reason=${report.issues.join(";")}`);
    process.exitCode = 1;
    return;
  }
  console.log("PASSED commercial_evidence");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--final")) {
  await runFinalCli();
}

