import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { scanTrackedSecrets } from "./verify-commercial-preflight.mjs";

export const COMMERCIAL_LOCAL_STEPS = Object.freeze([
  "typecheck",
  "lint",
  "build",
  "unit",
  "coverage",
  "database-static",
  "source-boundary",
  "security",
  "verifier-contracts",
  "delivery-artifacts",
  "secret-scan",
]);

const COMMANDS = new Map([
  ["typecheck", ["npm", ["run", "typecheck"]]],
  ["lint", ["npm", ["run", "lint"]]],
  ["build", ["npm", ["run", "build"]]],
  ["unit", ["npm", ["test"]]],
  ["coverage", ["npm", ["run", "test:coverage"]]],
  ["database-static", ["node", ["scripts/verify-database-reset.mjs", "--json"]]],
  ["source-boundary", ["node", ["scripts/scan-formal-public-surface.mjs", "--formal-imports", "--built-public-output"]]],
  ["security", ["npm", ["run", "test:security"]]],
  ["verifier-contracts", ["node", ["--test", "scripts/verify-commercial-evidence.test.mjs", "scripts/verify-commercial.test.mjs", "scripts/validate-delivery-artifacts.test.mjs", "tests/load/run-commercial-load.test.mjs"]]],
  ["delivery-artifacts", ["node", ["scripts/validate-delivery-artifacts.mjs"]]],
]);

function invocation(tool, args, runtime = { execPath: process.execPath, npmExecPath: process.env.npm_execpath }) {
  if (tool !== "npm") return { executable: runtime.execPath, args };
  const npmExecPath = runtime.npmExecPath || path.join(path.dirname(runtime.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return { executable: runtime.execPath, args: [npmExecPath, ...args] };
}

export async function executeCommercialLocalStep(step, {
  rootDir = process.cwd(),
  spawnProcess = spawnSync,
  runtime,
} = {}) {
  if (step === "secret-scan") {
    const violations = await scanTrackedSecrets({ rootDir, spawnProcess });
    if (violations.length) throw new Error("secret_scan_failed");
    return;
  }
  const specification = COMMANDS.get(step);
  if (!specification) throw new Error("local_step_unknown");
  const processSpec = invocation(specification[0], specification[1], runtime);
  const result = spawnProcess(processSpec.executable, processSpec.args, { cwd: rootDir, env: process.env, shell: false, stdio: "inherit" });
  if (result?.status !== 0) {
    const error = new Error("commercial_local_failed");
    error.step = step;
    throw error;
  }
}

export async function runCommercialLocal({ rootDir = process.cwd(), runStep = executeCommercialLocalStep } = {}) {
  const completed = [];
  for (const step of COMMERCIAL_LOCAL_STEPS) {
    await runStep(step, { rootDir });
    completed.push(step);
  }
  return {
    status: "LOCAL_STATIC_PASS",
    claim: "pending_authorized_staging_database_browser_load_and_real_device_evidence",
    completed,
  };
}

async function runCli() {
  try {
    const report = await runCommercialLocal();
    console.log(`PASSED commercial_local steps=${report.completed.length} claim=${report.claim}`);
  } catch (error) {
    console.error(`BLOCKED commercial_local step=${COMMERCIAL_LOCAL_STEPS.includes(error?.step) ? error.step : "unknown"}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli();

