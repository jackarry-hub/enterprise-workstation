import { pathToFileURL } from "node:url";

import { runDbCommand } from "../db-command-runner.mjs";

const PHASE2_DATABASE_COMMANDS = Object.freeze(Object.assign(Object.create(null), {
  "dry-run": "db:migrate:dry-run",
  "db-test": "db:test",
}));

function blocked(failureCategory) {
  return {
    failureCategory,
    outcome: "BLOCKED",
    status: 1,
  };
}

function safeFailureCategory(error) {
  return error?.message === "database_command_forbidden"
    || error?.message === "environment_mutation_forbidden"
    ? error.message
    : "database_command_forbidden";
}

export async function runSupabaseCommand(mode, {
  databaseUrl,
  environment,
  runDbCommandImpl = runDbCommand,
  runtime,
  spawnProcess,
} = {}) {
  const command = PHASE2_DATABASE_COMMANDS[mode];
  if (typeof command !== "string") return blocked("database_command_forbidden");

  try {
    return await runDbCommandImpl({
      command,
      databaseUrl,
      environment,
      runtime,
      spawnProcess,
    });
  } catch (error) {
    return blocked(safeFailureCategory(error));
  }
}

export async function runSupabaseCommandCli(argv = process.argv, environment = process.env) {
  const mode = argv[2];
  const result = await runSupabaseCommand(mode, {
    databaseUrl: environment.QUANTXY_DATABASE_URL,
    environment: environment.QUANTXY_ENVIRONMENT,
  });
  const output = `${result.outcome} phase2_command=${mode ?? "unknown"}${result.failureCategory ? ` category=${result.failureCategory}` : ""}`;
  (result.outcome === "PASSED" ? console.log : console.error)(output);
  if (result.status !== 0) process.exitCode = result.status;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSupabaseCommandCli();
}
