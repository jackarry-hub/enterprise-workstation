import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertSafeDatabaseTarget } from "./environment-guard.mjs";

export const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLI_MAX_BUFFER = 1_048_576;
const MIN_CLI_TIMEOUT_MS = 60_000;
const MAX_CLI_TIMEOUT_MS = 600_000;
const DEFAULT_CLI_TIMEOUTS = new Map([
  ["db:migrate:dry-run", 300_000],
  ["db:test", 300_000],
  ["db:reset:test", 600_000],
]);

const DB_COMMANDS = new Map([
  ["db:reset:test", (databaseUrl) => ["supabase", "db", "reset", "--db-url", databaseUrl]],
  ["db:migrate:dry-run", (databaseUrl) => ["supabase", "db", "push", "--dry-run", "--db-url", databaseUrl]],
  ["db:test", (databaseUrl) => ["supabase", "test", "db", "--db-url", databaseUrl]],
]);

const VERIFIER_REQUIRED_COMMANDS = new Set([
  "db:seed:validate",
  "db:rollback:test",
]);

function optionValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function buildNpxProcess(commandArgs, runtime = {
  execPath: process.execPath,
  npmExecPath: process.env.npm_execpath,
}) {
  const npmExecPath = runtime.npmExecPath
    || path.join(path.dirname(runtime.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return {
    executable: runtime.execPath,
    args: [path.join(path.dirname(npmExecPath), "npx-cli.js"), ...commandArgs],
  };
}

function commandTimeout(command, environment = process.env) {
  const configured = environment.QUANTXY_DB_COMMAND_TIMEOUT_MS;
  if (typeof configured === "string" && /^[0-9]+$/.test(configured.trim())) {
    const timeout = Number(configured.trim());
    if (Number.isSafeInteger(timeout) && timeout >= MIN_CLI_TIMEOUT_MS && timeout <= MAX_CLI_TIMEOUT_MS) {
      return timeout;
    }
  }
  return DEFAULT_CLI_TIMEOUTS.get(command) ?? 300_000;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function databaseSensitiveValues(databaseUrl) {
  const values = new Set([databaseUrl]);
  try {
    const url = new URL(databaseUrl);
    values.add(url.href);
    values.add(url.username);
    values.add(url.password);
    values.add(url.hostname);
    values.add(decodeURIComponent(url.username));
    values.add(decodeURIComponent(url.password));
  } catch {
    // The guard controls malformed URLs; diagnostics still must not echo the raw input.
  }
  return [...values].filter((value) => typeof value === "string" && value.length > 0)
    .sort((left, right) => right.length - left.length);
}

function redactCliText(value, databaseUrl) {
  let redacted = String(value ?? "");
  redacted = redacted.replace(/\bpostgres(?:ql)?:\/\/[^\s'"`]+/gi, "[database-url]");
  for (const sensitiveValue of databaseSensitiveValues(databaseUrl)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(sensitiveValue), "gi"), "[redacted]");
  }
  return redacted
    .replace(/\b(?:password|pwd|token|secret|api[_-]?key|apikey|authorization|host)\b\s*(?:=|:)\s*[^\s,;]+/gi, (match) => {
      const separator = match.includes(":") && !match.includes("=") ? ":" : "=";
      return `${match.split(/[=:]/, 1)[0]}${separator}[redacted]`;
    })
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=:-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sb_secret|sk|pk)_[A-Za-z0-9_-]+\b/gi, "[redacted]");
}

function bounded(value, limit = 480) {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function summarizeCliResult(result, databaseUrl, fallback = undefined) {
  const redacted = redactCliText(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`, databaseUrl);
  const lines = redacted.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const plan = redacted.match(/(?:^|\n)\s*1\.\.(\d+)\b/m);
  const failed = redacted.match(/(?:^|\n)\s*not ok\s+\d+\s*-\s*([^\r\n]+)/im);
  const migration = redacted.match(/\b(?:Applying\s+migration\s+|migration\s+)([A-Za-z0-9_.-]+(?:\.sql)?)/i);
  const errorLine = lines.find((line) => /\b(?:error|fatal|failed)\b/i.test(line));
  return {
    errorSummary: bounded(errorLine ?? fallback ?? "database_cli_failed"),
    failedTest: failed ? bounded(failed[1]) : undefined,
    migration: migration ? bounded(migration[1]) : undefined,
    testCount: plan ? Number(plan[1]) : undefined,
  };
}

function blockedResult(fingerprint, failureCategory, evidence) {
  return {
    fingerprint,
    failureCategory,
    outcome: "BLOCKED",
    status: 1,
    evidence,
  };
}

export function formatDbCommandResult(command, result) {
  const base = `${result.outcome} database_command=${command} environment=${result.fingerprint.environment} target=${result.fingerprint.target}`;
  if (result.outcome === "PASSED") return base;
  const fields = [
    `category=${result.failureCategory}`,
    result.evidence?.testCount === undefined ? undefined : `tests=${result.evidence.testCount}`,
    result.evidence?.failedTest ? `failed_test=${result.evidence.failedTest}` : undefined,
    result.evidence?.migration ? `migration=${result.evidence.migration}` : undefined,
    result.evidence?.errorSummary ? `error=${result.evidence.errorSummary}` : undefined,
  ].filter(Boolean);
  return `${base} ${fields.join(" ")}`;
}

export async function runDbCommand({
  command,
  environment,
  databaseUrl,
  spawnProcess = spawnSync,
  runtime,
}) {
  const fingerprint = assertSafeDatabaseTarget({ command, environment, databaseUrl });
  if (VERIFIER_REQUIRED_COMMANDS.has(command)) {
    return blockedResult(fingerprint, "database_verifier_unavailable", {
      errorSummary: "database_verifier_unavailable",
      failedTest: undefined,
      migration: undefined,
      testCount: undefined,
    });
  }

  const buildCommand = DB_COMMANDS.get(command);
  if (typeof buildCommand !== "function") throw new Error("database_command_forbidden");
  const invocation = buildNpxProcess(buildCommand(databaseUrl), runtime);
  const result = spawnProcess(invocation.executable, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: CLI_MAX_BUFFER,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: commandTimeout(command),
  });
  const status = typeof result?.status === "number" ? result.status : 1;
  if (status === 0) {
    return {
      fingerprint,
      failureCategory: undefined,
      outcome: "PASSED",
      status: 0,
      evidence: summarizeCliResult(result, databaseUrl, "database_cli_succeeded"),
    };
  }
  const failureCategory = result?.error
    ? "database_cli_unavailable"
    : "database_cli_failed";
  return blockedResult(
    fingerprint,
    failureCategory,
    summarizeCliResult(result, databaseUrl, failureCategory),
  );
}

export async function runDbCommandCli(argv = process.argv, environment = process.env) {
  const command = argv[2];
  const selectedEnvironment = environment.QUANTXY_ENVIRONMENT ?? optionValue(argv, "--environment");
  const databaseUrl = environment.QUANTXY_DATABASE_URL
    ?? optionValue(argv, "--database-url")
    ?? LOCAL_DATABASE_URL;
  try {
    const result = await runDbCommand({
      command,
      environment: selectedEnvironment,
      databaseUrl,
    });
    const output = formatDbCommandResult(command, result);
    (result.outcome === "PASSED" ? console.log : console.error)(output);
    if (result.status !== 0) process.exitCode = result.status;
    return result;
  } catch (error) {
    const reason = error?.message === "database_command_forbidden"
      ? "database_command_forbidden"
      : "environment_mutation_forbidden";
    console.error(`BLOCKED database_command=${command ?? "unknown"} reason=${reason}`);
    process.exitCode = 1;
    return { outcome: "BLOCKED", status: 1 };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDbCommandCli();
}
