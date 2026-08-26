import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runDbCommand } from "./db-command-runner.mjs";

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

function blocked(category = "phase_gate_failed") {
  const error = new Error("phase_gate_blocked");
  error.category = category;
  throw error;
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
      databaseUrl,
      spawnProcess,
      runtime,
    });
    if (result.outcome !== "PASSED" || result.status !== 0) {
      blocked(result.failureCategory ?? "database_gate_blocked");
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
    console.error(`BLOCKED phase_gate=${gate ?? "unknown"} category=${error?.category ?? "phase_gate_failed"}`);
    process.exitCode = 1;
    return { gate, outcome: "BLOCKED", status: 1 };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runPhaseGateCli();
}
