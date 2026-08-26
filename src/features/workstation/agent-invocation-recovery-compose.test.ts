// @vitest-environment node

import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

const workerScript = resolve(process.cwd(), "scripts/agent-invocation-recovery-worker.mjs");
const compose = readFileSync(resolve(process.cwd(), "compose.yaml"), "utf8");
const secret = "agent-recovery-secret-that-must-never-be-logged";

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
      AGENT_INVOCATION_RECOVERY_CRON_SECRET: secret,
      AGENT_INVOCATION_RECOVERY_URL: `http://127.0.0.1:${address.port}/api/internal/agent-invocation-recovery`,
    });
  } finally {
    server.close();
    await once(server, "close");
  }
}

describe("Agent invocation recovery Compose worker", () => {
  it("treats a 307 as a failed cycle and emits only a stable redacted error", async () => {
    const result = await runWorkerOnce(307);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("agent_invocation_recovery_request_failed status=307\n");
    expect(result.stderr).not.toContain(secret);
  });

  it("accepts only HTTP 200 as a successful cycle", async () => {
    const result = await runWorkerOnce(200);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("records a stable redacted connection failure before the next scheduled cycle", async () => {
    const result = await runWorker({
      ...process.env,
      AGENT_INVOCATION_RECOVERY_CRON_SECRET: secret,
      AGENT_INVOCATION_RECOVERY_URL: "http://127.0.0.1:1/api/internal/agent-invocation-recovery",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("agent_invocation_recovery_request_failed status=network_error\n");
    expect(result.stderr).not.toContain(secret);
  });

  it("builds the worker image from the executable rather than swallowing curl failures inline", () => {
    expect(compose).toContain("dockerfile: Dockerfile.agent-invocation-recovery");
    expect(compose).not.toContain("curl --fail");
    expect(compose).not.toContain("agent-invocation-recovery || true");
  });
});
