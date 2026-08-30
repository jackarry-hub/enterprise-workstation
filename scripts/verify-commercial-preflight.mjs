import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const COMMERCIAL_PREFLIGHT_STEPS = Object.freeze([
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
]);

const SCRIPT_INTEGRATION_TESTS = Object.freeze([
  "scripts/environment-guard.test.mjs",
  "scripts/db-command-runner.test.mjs",
  "scripts/phase-gates.test.mjs",
  "scripts/scan-formal-public-surface.test.mjs",
  "scripts/verify-database-reset.test.mjs",
  "scripts/verify-commercial-preflight.test.mjs",
  "scripts/collect-commercial-evidence.test.mjs",
  "scripts/validate-waf-evidence.test.mjs",
  "scripts/phase1/provision-roster.test.mjs",
  "scripts/phase2/migration-sql.test.mjs",
  "scripts/phase2/remote-config.test.mjs",
  "scripts/phase2/supabase-command.test.mjs",
  "scripts/phase2/verify-remote.test.mjs",
]);

const PROCESS_STEPS = new Map([
  ["npm-ci", { tool: "npm", args: ["ci"] }],
  ["db-migrate-dry-run", { tool: "npm", args: ["run", "db:migrate:dry-run"] }],
  ["typecheck", { tool: "npm", args: ["run", "typecheck"] }],
  ["lint", { tool: "npm", args: ["run", "lint"] }],
  ["build", { tool: "npm", args: ["run", "build"] }],
  ["unit", { tool: "npm", args: ["test"] }],
  ["coverage", { tool: "npm", args: ["run", "test:coverage"] }],
  ["db-test-pgtap-rls", { tool: "npm", args: ["run", "db:test"] }],
  ["integration", { tool: "node", args: ["--test", ...SCRIPT_INTEGRATION_TESTS] }],
  ["desktop-e2e", {
    tool: "npx",
    args: ["--no-install", "playwright", "test", "--project=desktop-chrome"],
  }],
  ["emulated-mobile-e2e", {
    tool: "npx",
    args: [
      "--no-install", "playwright", "test",
      "--project=iphone-13", "--project=pixel-7", "--project=ipad-mini",
    ],
  }],
  ["a11y", {
    tool: "npx",
    args: [
      "--no-install", "playwright", "test", "tests/e2e/accessibility.spec.ts",
      "--project=desktop-chrome", "--project=iphone-13",
    ],
  }],
  ["dependency-scan", { tool: "npm", args: ["run", "test:security"] }],
]);

const SECRET_PATTERNS = Object.freeze([
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github_token", /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["openai_key", /\bsk-(?:proj-|live-)[A-Za-z0-9_-]{32,}\b/],
  ["supabase_secret", /\bsb_secret_[A-Za-z0-9_-]{30,}\b/],
]);

const FORBIDDEN_TRACKED_NAMES = /(^|\/)(?:\.env(?:\.[^/]+)?|[^/]+\.(?:pem|p12|pfx|key))$/i;
const ALLOWED_ENV_EXAMPLES = /(^|\/)\.env(?:\.[^/]+)?\.(?:example|sample)$/i;

function npmInvocation(args, runtime) {
  const npmExecPath = runtime.npmExecPath
    || process.env.npm_execpath
    || path.join(path.dirname(runtime.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return { executable: runtime.execPath, args: [npmExecPath, ...args] };
}

function npxInvocation(args, runtime) {
  const npmExecPath = runtime.npmExecPath
    || process.env.npm_execpath
    || path.join(path.dirname(runtime.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return {
    executable: runtime.execPath,
    args: [path.join(path.dirname(npmExecPath), "npx-cli.js"), ...args],
  };
}

function processInvocation(specification, runtime = { execPath: process.execPath }) {
  if (specification.tool === "npm") return npmInvocation(specification.args, runtime);
  if (specification.tool === "npx") return npxInvocation(specification.args, runtime);
  return { executable: runtime.execPath, args: specification.args };
}

function stepError(step, category = "command_failed") {
  const error = new Error("commercial_preflight_failed");
  error.step = COMMERCIAL_PREFLIGHT_STEPS.includes(step) ? step : "unknown";
  error.category = category;
  return error;
}

export function formatPreflightFailure(error) {
  const step = COMMERCIAL_PREFLIGHT_STEPS.includes(error?.step) ? error.step : "unknown";
  const category = error?.category === "secret_detected" ? "secret_detected" : "command_failed";
  return `BLOCKED commercial_preflight step=${step} category=${category}`;
}

export async function scanTrackedSecrets({
  rootDir = process.cwd(),
  spawnProcess = spawnSync,
  readFileImpl = readFile,
} = {}) {
  const listed = spawnProcess("git", ["ls-files", "-z"], {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (listed?.status !== 0 || typeof listed?.stdout !== "string") {
    throw stepError("secret-scan");
  }
  const files = listed.stdout.split("\0").filter(Boolean);
  const violations = [];
  for (const relativePath of files) {
    const normalizedPath = relativePath.replaceAll("\\", "/");
    if (FORBIDDEN_TRACKED_NAMES.test(normalizedPath) && !ALLOWED_ENV_EXAMPLES.test(normalizedPath)) {
      violations.push({ file: normalizedPath, type: "sensitive_file" });
      continue;
    }
    let source;
    try {
      source = await readFileImpl(path.join(rootDir, relativePath), "utf8");
    } catch {
      continue;
    }
    if (source.includes("\0")) continue;
    for (const [type, expression] of SECRET_PATTERNS) {
      if (expression.test(source)) violations.push({ file: normalizedPath, type });
    }
  }
  return violations;
}

export async function executePreflightStep(step, {
  rootDir = process.cwd(),
  spawnProcess = spawnSync,
  runtime = { execPath: process.execPath },
} = {}) {
  if (step === "secret-scan") {
    const violations = await scanTrackedSecrets({ rootDir, spawnProcess });
    if (violations.length > 0) throw stepError(step, "secret_detected");
    return { step, status: "PASSED" };
  }
  const specification = PROCESS_STEPS.get(step);
  if (!specification) throw stepError(step);
  const invocation = processInvocation(specification, runtime);
  const result = spawnProcess(invocation.executable, invocation.args, {
    cwd: rootDir,
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result?.status !== 0) throw stepError(step);
  return { step, status: "PASSED" };
}

export async function runCommercialPreflight({
  runStep = executePreflightStep,
  rootDir = process.cwd(),
} = {}) {
  const completed = [];
  for (const step of COMMERCIAL_PREFLIGHT_STEPS) {
    await runStep(step, { rootDir });
    completed.push(step);
  }
  return {
    status: "PREFLIGHT_PASS",
    claim: "preliminary_only",
    completed,
  };
}

async function runCli() {
  try {
    const report = await runCommercialPreflight();
    console.log(`PASSED commercial_preflight steps=${report.completed.length} claim=${report.claim}`);
  } catch (error) {
    console.error(formatPreflightFailure(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
