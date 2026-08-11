import { spawnSync } from "node:child_process";
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

export function runSupabaseCommand(mode) {
  const config = loadRemoteConfig();
  console.log(JSON.stringify(summarizeRemoteConfig(config)));

  const [command, ...args] = buildSupabaseCommand(mode, config.dbUrl);
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(executable, [command, ...args], {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSupabaseCommand(process.argv[2]);
}
