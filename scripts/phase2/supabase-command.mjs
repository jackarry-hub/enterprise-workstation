import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadRemoteConfig,
  summarizeRemoteConfig,
} from "./remote-config.mjs";

const COMMANDS = {
  check: ["supabase", "migration", "list"],
  "dry-run": ["supabase", "db", "push", "--dry-run"],
  push: ["supabase", "db", "push", "--yes"],
  "db-test": [
    "supabase",
    "test",
    "db",
    "supabase/tests/phase1_identity_rbac.sql",
  ],
};

export function buildSupabaseCommand(mode, dbUrl) {
  const base = COMMANDS[mode];
  if (!base) throw new Error(`不支持的 Phase2 命令：${mode}`);
  return [...base, "--db-url", dbUrl];
}

export function buildSupabaseProcess(
  commandArgs,
  runtime = {
    execPath: process.execPath,
    npmExecPath: process.env.npm_execpath,
  },
) {
  const npmExecPath = runtime.npmExecPath
    || path.join(
      path.dirname(runtime.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
  const npxCliPath = path.join(path.dirname(npmExecPath), "npx-cli.js");

  return {
    executable: runtime.execPath,
    args: [npxCliPath, ...commandArgs],
  };
}

export function runSupabaseCommand(mode) {
  const config = loadRemoteConfig();
  console.log(JSON.stringify(summarizeRemoteConfig(config)));

  const [command, ...args] = buildSupabaseCommand(mode, config.dbUrl);
  const invocation = buildSupabaseProcess([command, ...args]);
  const result = spawnSync(invocation.executable, invocation.args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSupabaseCommand(process.argv[2]);
}
