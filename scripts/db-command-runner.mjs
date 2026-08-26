import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertSafeDatabaseTarget } from "./environment-guard.mjs";

const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const DB_COMMANDS = {
  "db:reset:test": (databaseUrl) => ["supabase", "db", "reset", "--db-url", databaseUrl],
  "db:migrate:dry-run": (databaseUrl) => ["supabase", "db", "push", "--dry-run", "--db-url", databaseUrl],
  "db:test": (databaseUrl) => ["supabase", "test", "db", "--db-url", databaseUrl],
  "db:seed:validate": (databaseUrl) => ["supabase", "db", "reset", "--db-url", databaseUrl],
  "db:rollback:test": (databaseUrl) => ["supabase", "db", "reset", "--db-url", databaseUrl],
};

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

export async function runDbCommand({
  command,
  environment,
  databaseUrl,
  spawnProcess = spawnSync,
  runtime,
}) {
  const buildCommand = DB_COMMANDS[command];
  if (!buildCommand) throw new Error("database_command_forbidden");

  const fingerprint = assertSafeDatabaseTarget({ command, environment, databaseUrl });
  const invocation = buildNpxProcess(buildCommand(databaseUrl), runtime);
  const result = spawnProcess(invocation.executable, invocation.args, {
    cwd: process.cwd(),
    shell: false,
    stdio: "ignore",
  });
  const status = typeof result?.status === "number" ? result.status : 1;
  const failureCategory = status === 0
    ? undefined
    : result?.error
      ? "database_cli_unavailable"
      : "database_cli_failed";

  return {
    fingerprint,
    failureCategory,
    outcome: status === 0 ? "PASSED" : "BLOCKED",
    status,
  };
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
    console.log(`${result.outcome} database_command=${command} environment=${result.fingerprint.environment} target=${result.fingerprint.target}${result.failureCategory ? ` category=${result.failureCategory}` : ""}`);
    if (result.status !== 0) process.exitCode = result.status;
    return result;
  } catch (error) {
    console.error(`BLOCKED database_command=${command ?? "unknown"} reason=${error?.message === "database_command_forbidden" ? "database_command_forbidden" : "environment_mutation_forbidden"}`);
    process.exitCode = 1;
    return { outcome: "BLOCKED", status: 1 };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDbCommandCli();
}
