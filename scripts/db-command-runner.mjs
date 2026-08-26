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

const SAFE_FAILURE_SUMMARIES = new Set([
  "connection_refused",
  "auth_failed",
  "timeout",
  "test_failed",
  "migration_failed",
  "cli_failed",
]);
const SAFE_STATIC_SUMMARIES = new Set(["database_verifier_unavailable"]);
const SAFE_MIGRATION_IDENTIFIER = /^\d{12}_[a-z0-9][a-z0-9_-]*\.sql$/;
const MAX_TEST_COUNT = 1_000_000;

function safePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_TEST_COUNT
    ? value
    : undefined;
}

function isSafeSqlState(value) {
  return typeof value === "string"
    && /\d/.test(value)
    && (
      /^[0-9]{2}[A-Z0-9]{3}$/.test(value)
      || /^[A-Z][0-9][A-Z0-9]{3}$/.test(value)
      || /^[A-Z]{2}[0-9][A-Z0-9]{2}$/.test(value)
      || /^[0-9][A-Z][A-Z0-9]{3}$/.test(value)
    );
}

function safeSqlState(source) {
  const matcher = /\b(?:sql\s*state|sqlstate|code)\b\s*(?:=|:)?\s*["']?([A-Z0-9]{5})\b/gi;
  for (const match of String(source ?? "").matchAll(matcher)) {
    const candidate = match[1].toUpperCase();
    if (isSafeSqlState(candidate)) return candidate;
  }
  return undefined;
}

function safeMigrationIdentifier(value) {
  return typeof value === "string" && SAFE_MIGRATION_IDENTIFIER.test(value)
    ? value
    : undefined;
}

function safeErrorSummary(value) {
  if (typeof value !== "string") return undefined;
  if (SAFE_STATIC_SUMMARIES.has(value)) return value;
  const match = value.match(/^(connection_refused|auth_failed|timeout|test_failed|migration_failed|cli_failed)(?::([A-Z0-9]{5}))?$/);
  if (!match || !SAFE_FAILURE_SUMMARIES.has(match[1])) return undefined;
  return match[2] && isSafeSqlState(match[2]) ? `${match[1]}:${match[2]}` : match[1];
}

export function normalizeDatabaseEvidence(evidence = {}) {
  const testCount = safePositiveInteger(evidence.testCount);
  const failedTestNumber = safePositiveInteger(evidence.failedTestNumber);
  return {
    errorSummary: safeErrorSummary(evidence.errorSummary),
    failedTest: failedTestNumber ? `test_${failedTestNumber}` : undefined,
    failedTestNumber,
    migration: safeMigrationIdentifier(evidence.migration),
    testCount,
  };
}

function classifyFailure(source, evidence) {
  const text = String(source ?? "");
  const summary = /\b(?:timed out|timeout|etimedout)\b/i.test(text)
    ? "timeout"
    : /\b(?:password authentication failed|authentication failed|28P01)\b/i.test(text)
      ? "auth_failed"
      : /\b(?:connection refused|econnrefused)\b/i.test(text)
        ? "connection_refused"
        : !evidence.failedTestNumber && evidence.migration && /\b(?:error|fatal|failed)\b/i.test(text)
          ? "migration_failed"
          : evidence.failedTestNumber
            ? "test_failed"
            : "cli_failed";
  const sqlState = safeSqlState(text);
  return sqlState ? `${summary}:${sqlState}` : summary;
}

function summarizeCliResult(result) {
  const source = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}\n${result?.error?.code ?? ""}\n${result?.error?.message ?? ""}`;
  const plan = source.match(/(?:^|\n)\s*1\.\.(\d+)\b/m);
  const failed = source.match(/(?:^|\n)\s*not ok\s+(\d+)(?:\s*-\s*([^\r\n]+))?/im);
  const migration = source.match(/(?:^|\n)\s*(?:Applying\s+migration\s+|migration\s+)([^\s\r\n]+)/im);
  const evidence = {
    failedTest: failed?.[2]?.trim(),
    failedTestNumber: failed ? Number(failed[1]) : undefined,
    migration: migration?.[1],
    testCount: plan ? Number(plan[1]) : undefined,
  };
  return normalizeDatabaseEvidence({
    ...evidence,
    errorSummary: classifyFailure(source, evidence),
  });
}

function blockedResult(fingerprint, failureCategory, evidence) {
  return {
    fingerprint,
    failureCategory,
    outcome: "BLOCKED",
    status: 1,
    evidence: normalizeDatabaseEvidence(evidence),
  };
}

export function formatDbCommandResult(command, result) {
  const base = `${result.outcome} database_command=${command} environment=${result.fingerprint.environment} target=${result.fingerprint.target}`;
  if (result.outcome === "PASSED") return base;
  const evidence = normalizeDatabaseEvidence(result.evidence);
  const fields = [
    `category=${result.failureCategory}`,
    evidence.testCount === undefined ? undefined : `tests=${evidence.testCount}`,
    evidence.failedTestNumber === undefined ? undefined : `failed_test_number=${evidence.failedTestNumber}`,
    evidence.failedTest ? `failed_test=${evidence.failedTest}` : undefined,
    evidence.migration ? `migration=${evidence.migration}` : undefined,
    evidence.errorSummary ? `error=${evidence.errorSummary}` : undefined,
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
      failedTestNumber: undefined,
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
      evidence: normalizeDatabaseEvidence(),
    };
  }
  const failureCategory = result?.error
    ? "database_cli_unavailable"
    : "database_cli_failed";
  return blockedResult(
    fingerprint,
    failureCategory,
    summarizeCliResult(result),
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
