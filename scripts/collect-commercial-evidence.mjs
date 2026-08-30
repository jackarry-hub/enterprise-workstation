import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { runScan } from "./scan-formal-public-surface.mjs";

export const COMMERCIAL_EVIDENCE_COMMANDS = Object.freeze([
  "npm run verify:commercial:preflight",
  "npx playwright test tests/e2e/commercial-journeys.spec.ts",
  "node scripts/scan-formal-public-surface.mjs --formal-imports --built-public-output",
]);

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

async function migrationManifest(rootDir) {
  const directory = path.join(rootDir, "supabase", "migrations");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async (file) => ({
    file: `supabase/migrations/${file}`,
    sha256: sha256(await readFile(path.join(directory, file))),
  })));
}

function trackedCommit(rootDir, spawnProcess = spawnSync) {
  const result = spawnProcess("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const commit = result?.status === 0 ? result.stdout?.trim() : "";
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("candidate_commit_unavailable");
  return commit;
}

function safeArtifactPaths(value, paths = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => safeArtifactPaths(item, paths));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if ((key === "path" || key === "outputDir") && typeof child === "string") {
        const normalized = child.replaceAll("\\", "/");
        if (!normalized.includes("..") && !/[\u0000-\u001f\u007f]/.test(normalized)) paths.add(normalized);
      } else safeArtifactPaths(child, paths);
    }
  }
  return paths;
}

function resultSummary(report) {
  const stats = report?.stats;
  if (!stats || !Number.isSafeInteger(stats.expected) || !Number.isSafeInteger(stats.unexpected)
    || !Number.isSafeInteger(stats.skipped) || !Number.isSafeInteger(stats.flaky)
    || typeof stats.startTime !== "string" || !Number.isFinite(Date.parse(stats.startTime))
    || typeof stats.duration !== "number" || stats.duration < 0) {
    throw new Error("playwright_results_invalid");
  }
  return {
    startedAt: new Date(stats.startTime).toISOString(),
    completedAt: new Date(Date.parse(stats.startTime) + stats.duration).toISOString(),
    passed: stats.expected + stats.flaky,
    failed: stats.unexpected,
    skipped: stats.skipped,
  };
}

export async function checkCommercialEvidenceHarness(rootDir = process.cwd()) {
  const [packageJson, playwright, journey] = await Promise.all([
    readFile(path.join(rootDir, "package.json"), "utf8"),
    readFile(path.join(rootDir, "playwright.config.ts"), "utf8"),
    readFile(path.join(rootDir, "tests", "e2e", "commercial-journeys.spec.ts"), "utf8"),
  ]);
  const issues = [];
  if (!JSON.parse(packageJson).scripts?.["verify:commercial:preflight"]) issues.push("preflight_alias_missing");
  if (!playwright.includes("quantxy-commercial-playwright-results.json")) issues.push("playwright_json_reporter_missing");
  if (!/workers:\s*1/.test(playwright)) issues.push("playwright_serial_isolation_missing");
  for (const route of ["/people", "/projects", "/tasks", "/customers", "/approvals", "/payroll", "/knowledge", "/assistant", "/agents", "/analytics", "/settings"]) {
    if (!journey.includes(`\"${route}\"`)) issues.push(`journey_route_missing:${route}`);
  }
  return { status: issues.length ? "BLOCKED" : "READY_TO_COLLECT", issues };
}

export async function collectCommercialEvidence({
  rootDir = process.cwd(),
  resultsPath = path.join(os.tmpdir(), "quantxy-commercial-playwright-results.json"),
  commit,
  spawnProcess = spawnSync,
  scanReport,
} = {}) {
  const harness = await checkCommercialEvidenceHarness(rootDir);
  if (harness.status !== "READY_TO_COLLECT") throw new Error("commercial_evidence_harness_blocked");
  const report = JSON.parse(await readFile(resultsPath, "utf8"));
  const summary = resultSummary(report);
  if (summary.failed !== 0) throw new Error("commercial_journey_failed");
  const scan = scanReport ?? await runScan({
    root: rootDir,
    formalImports: true,
    builtPublicOutput: true,
    terms: "leave|attendance|请假|考勤",
    allowlist: [],
  });
  if (scan.status !== "PASS") throw new Error("commercial_source_scan_failed");
  return {
    schemaVersion: 1,
    status: "PRELIMINARY_EVIDENCE",
    commercialVerification: "BLOCKED_PENDING_AUTHORIZED_STAGING",
    commit: commit ?? trackedCommit(rootDir, spawnProcess),
    migrations: await migrationManifest(rootDir),
    commands: [...COMMERCIAL_EVIDENCE_COMMANDS],
    ...summary,
    forbiddenSourcePaths: 0,
    artifactPaths: [...safeArtifactPaths(report)].sort(),
  };
}

function option(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function runCli(argv = process.argv) {
  try {
    if (argv.includes("--check")) {
      const report = await checkCommercialEvidenceHarness();
      console.log(JSON.stringify(report));
      if (report.status !== "READY_TO_COLLECT") process.exitCode = 1;
      return;
    }
    const manifest = await collectCommercialEvidence({ resultsPath: option(argv, "--results") });
    const output = option(argv, "--output")
      ?? path.join(process.cwd(), "artifacts", "commercial-evidence", `${manifest.commit}.json`);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(`PRELIMINARY_EVIDENCE commercial_evidence passed=${manifest.passed} failed=0 output=${path.basename(output)}`);
  } catch (error) {
    const reason = new Set([
      "commercial_evidence_harness_blocked",
      "commercial_journey_failed",
      "commercial_source_scan_failed",
      "playwright_results_invalid",
      "candidate_commit_unavailable",
    ]).has(error?.message) ? error.message : "commercial_evidence_unavailable";
    console.error(`BLOCKED commercial_evidence reason=${reason}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
