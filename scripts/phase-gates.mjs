import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  LOCAL_DATABASE_URL,
  normalizeDatabaseEvidence,
  runDbCommand,
} from "./db-command-runner.mjs";

const SAFE_PHASE_GATES = new Set(["coverage", "security", "rls"]);

function optionValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function buildNpmProcess(args, runtime = {
  execPath: process.execPath,
  npmExecPath: process.env.npm_execpath,
}) {
  const npmExecPath = runtime.npmExecPath
    || path.join(path.dirname(runtime.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return { executable: runtime.execPath, args: [npmExecPath, ...args] };
}

function blocked(category = "phase_gate_failed", evidence = undefined) {
  const error = new Error("phase_gate_blocked");
  error.category = category;
  error.evidence = normalizeDatabaseEvidence(evidence);
  throw error;
}

export function formatPhaseGateBlocked(gate, error) {
  const safeGate = SAFE_PHASE_GATES.has(gate) ? gate : "unknown";
  const category = typeof error?.category === "string" && /^[a-z_]+$/.test(error.category)
    ? error.category
    : "phase_gate_failed";
  const evidence = normalizeDatabaseEvidence(error?.evidence);
  const fields = [
    `BLOCKED phase_gate=${safeGate}`,
    `category=${category}`,
    evidence.testCount === undefined ? undefined : `tests=${evidence.testCount}`,
    evidence.failedTestNumber === undefined ? undefined : `failed_test_number=${evidence.failedTestNumber}`,
    evidence.failedTest ? `failed_test=${evidence.failedTest}` : undefined,
    evidence.migration ? `migration=${evidence.migration}` : undefined,
    evidence.errorSummary ? `error=${evidence.errorSummary}` : undefined,
  ].filter(Boolean);
  return fields.join(" ");
}

export async function runPhaseGate({
  gate,
  environment,
  databaseUrl,
  spawnProcess = spawnSync,
  runDbCommandImpl = runDbCommand,
  runtime,
}) {
  if (gate === "rls") {
    const result = await runDbCommandImpl({
      command: "db:test",
      environment,
      databaseUrl: databaseUrl ?? LOCAL_DATABASE_URL,
      spawnProcess,
      runtime,
    });
    if (result.outcome !== "PASSED" || result.status !== 0) {
      blocked(result.failureCategory ?? "database_gate_blocked", result.evidence);
    }
    return { gate, outcome: "PASSED", status: 0 };
  }

  const args = gate === "coverage"
    ? ["exec", "--", "vitest", "run", "src", "--coverage", "--maxWorkers=4"]
    : gate === "security"
      ? ["audit", "--omit=dev", "--audit-level=high"]
      : null;
  if (!args) blocked();

  const invocation = buildNpmProcess(args, runtime);
  const result = spawnProcess(invocation.executable, invocation.args, {
    cwd: process.cwd(),
    shell: false,
    stdio: "inherit",
  });
  if (result?.status !== 0) blocked("phase_gate_command_failed");
  return { gate, outcome: "PASSED", status: 0 };
}

export async function runPhaseGateCli(argv = process.argv, environment = process.env) {
  const gate = argv[2];
  try {
    const result = await runPhaseGate({
      gate,
      environment: environment.QUANTXY_ENVIRONMENT ?? optionValue(argv, "--environment"),
      databaseUrl: environment.QUANTXY_DATABASE_URL ?? optionValue(argv, "--database-url"),
    });
    console.log(`PASSED phase_gate=${result.gate}`);
    return result;
  } catch (error) {
    console.error(formatPhaseGateBlocked(gate, error));
    process.exitCode = 1;
    return { gate, outcome: "BLOCKED", status: 1 };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runPhaseGateCli();
}
