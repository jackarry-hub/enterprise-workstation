// @vitest-environment node

import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

const workerScript = resolve(process.cwd(), "scripts/task-notification-recovery-worker.mjs");
const compose = readFileSync(resolve(process.cwd(), "compose.yaml"), "utf8");
const secret = "task-notification-recovery-secret-not-for-logs";

function runWorker(environment: NodeJS.ProcessEnv) {
  return new Promise<{ exitCode: number | null; stderr: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, [workerScript, "--once"], {
      env: environment,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (exitCode) => resolveResult({ exitCode, stderr }));
  });
}

async function runWorkerOnce(status: number) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { location: "/login" });
    response.end("response body must never reach worker logs");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test_server_unavailable");
  try {
    return await runWorker({
      ...process.env,
      TASK_NOTIFICATION_RECOVERY_CRON_SECRET: secret,
      TASK_NOTIFICATION_RECOVERY_URL: `http://127.0.0.1:${address.port}/api/internal/task-notification-recovery`,
    });
  } finally {
    server.close();
    await once(server, "close");
  }
}

describe("Task notification recovery Compose worker", () => {
  it("accepts only HTTP 200 and never logs response bodies or secrets", async () => {
    const failed = await runWorkerOnce(307);
    expect(failed).toEqual({
      exitCode: 1,
      stderr: "task_notification_recovery_request_failed status=307\n",
    });
    expect(failed.stderr).not.toContain(secret);

    const succeeded = await runWorkerOnce(200);
    expect(succeeded).toEqual({ exitCode: 0, stderr: "" });
  });

  it("fails closed on network errors", async () => {
    const result = await runWorker({
      ...process.env,
      TASK_NOTIFICATION_RECOVERY_CRON_SECRET: secret,
      TASK_NOTIFICATION_RECOVERY_URL: "http://127.0.0.1:1/api/internal/task-notification-recovery",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("task_notification_recovery_request_failed status=network_error\n");
    expect(result.stderr).not.toContain(secret);
  });

  it("wires a dedicated worker and the same server-only secret into Compose", () => {
    expect(compose).toContain("task-notification-recovery:");
    expect(compose).toContain("dockerfile: Dockerfile.task-notification-recovery");
    expect(compose.match(/^\s+TASK_NOTIFICATION_RECOVERY_CRON_SECRET:/gm)).toHaveLength(2);
    expect(compose).not.toContain("task-notification-recovery || true");
  });
});
