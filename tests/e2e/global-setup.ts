import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { prepareAuthStates } from "./auth-state";

export default async function globalSetup() {
  loadEnvConfig(process.cwd());
  const configuredRunId = process.env.QUANTXY_E2E_RUN_ID?.trim();
  const runId = configuredRunId && /^[a-zA-Z0-9-]{8,80}$/.test(configuredRunId)
    ? configuredRunId
    : `commercial-${randomUUID()}`;
  process.env.QUANTXY_E2E_RUN_ID = runId;
  await prepareAuthStates();
  await writeFile(
    path.join(tmpdir(), "quantxy-commercial-e2e-run.json"),
    JSON.stringify({ runId, startedAt: new Date().toISOString(), scope: "local-supabase-only" }),
    { encoding: "utf8", mode: 0o600 },
  );
}
