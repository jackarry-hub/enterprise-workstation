import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_INTEGER_KEYS = Object.freeze([
  "seededStaff",
  "activeUsers",
  "concurrentWrites",
  "queuedAiAgentJobs",
]);

export function parseCommercialThresholds(source) {
  const parsed = {};
  for (const line of String(source).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.+?)\s*$/);
    if (!match) continue;
    const raw = match[2];
    parsed[match[1]] = /^-?(?:\d+\.?\d*|\.\d+)$/.test(raw) ? Number(raw) : raw;
  }
  return parsed;
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateCommercialLoadResult(result, thresholds) {
  const issues = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) return ["load_result_invalid"];
  for (const key of REQUIRED_INTEGER_KEYS) {
    if (!Number.isSafeInteger(result[key]) || result[key] !== thresholds[key]) issues.push(`${key}_mismatch`);
  }
  if (!finiteNonNegative(result.nonAiP95Ms) || result.nonAiP95Ms > thresholds.nonAiP95MsMax) {
    issues.push("non_ai_p95_exceeded");
  }
  if (!finiteNonNegative(result.errorRate) || result.errorRate >= thresholds.errorRateMaxExclusive) {
    issues.push("error_rate_exceeded");
  }
  if (!finiteNonNegative(result.mobileInteractiveMs) || result.mobileInteractiveMs > thresholds.mobileInteractiveMsMax) {
    issues.push("mobile_interactive_exceeded");
  }
  if (result.environment !== "Staging") issues.push("staging_environment_required");
  if (!/^[0-9a-f]{40}$/.test(result.candidateCommit ?? "")) issues.push("candidate_commit_invalid");
  if (typeof result.measuredAt !== "string" || !Number.isFinite(Date.parse(result.measuredAt))) issues.push("measured_at_invalid");
  return issues;
}

export async function runCommercialLoadGate({
  resultPath,
  thresholdsPath = path.join(process.cwd(), "tests", "load", "commercial-thresholds.yml"),
} = {}) {
  if (!resultPath) return { status: "BLOCKED", issues: ["load_evidence_path_required"] };
  const [thresholdSource, resultSource] = await Promise.all([
    readFile(thresholdsPath, "utf8"),
    readFile(resultPath, "utf8"),
  ]);
  const thresholds = parseCommercialThresholds(thresholdSource);
  const result = JSON.parse(resultSource);
  const issues = validateCommercialLoadResult(result, thresholds);
  return { status: issues.length ? "BLOCKED" : "PASSED", issues, result, thresholds };
}

function option(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function runCli(argv = process.argv) {
  try {
    const report = await runCommercialLoadGate({
      resultPath: option(argv, "--result") ?? process.env.QUANTXY_LOAD_EVIDENCE,
    });
    if (report.status !== "PASSED") {
      console.error(`BLOCKED commercial_load reason=${report.issues.join(",")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`PASSED commercial_load p95_ms=${report.result.nonAiP95Ms} error_rate=${report.result.errorRate} mobile_ms=${report.result.mobileInteractiveMs}`);
  } catch {
    console.error("BLOCKED commercial_load reason=load_evidence_invalid");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli();

