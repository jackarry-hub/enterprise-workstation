// @vitest-environment node

import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

const workerScript = resolve(process.cwd(), "scripts/file-upload-cleanup-worker.mjs");
const compose = readFileSync(resolve(process.cwd(), "compose.yaml"), "utf8");
const secret = "file-cleanup-secret-that-must-never-be-logged";

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

async function runOnce(status: number) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { location: "/login" });
    response.end("private provider response");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test_server_unavailable");
  try {
    return await runWorker({
      ...process.env,
      FILE_UPLOAD_CLEANUP_CRON_SECRET: secret,
      FILE_UPLOAD_CLEANUP_URL: `http://127.0.0.1:${address.port}/api/internal/file-upload-cleanup`,
    });
  } finally {
    server.close();
    await once(server, "close");
  }
}

describe("file upload cleanup Compose worker", () => {
  it("accepts only HTTP 200", async () => {
    expect((await runOnce(200)).exitCode).toBe(0);
    const redirected = await runOnce(307);
    expect(redirected.exitCode).toBe(1);
    expect(redirected.stderr).toBe("file_upload_cleanup_request_failed status=307\n");
    expect(redirected.stderr).not.toContain(secret);
  });

  it("is a dedicated non-root worker without swallowed failures", () => {
    expect(compose).toContain("dockerfile: Dockerfile.file-upload-cleanup");
    expect(compose).toContain("FILE_UPLOAD_CLEANUP_CRON_SECRET");
    expect(compose).not.toContain("file-upload-cleanup || true");
  });

  it("does not forward the cleanup secret to an insecure external host", async () => {
    const result = await runWorker({
      ...process.env,
      FILE_UPLOAD_CLEANUP_CRON_SECRET: secret,
      FILE_UPLOAD_CLEANUP_URL: "http://example.test/api/internal/file-upload-cleanup",
    });
    expect(result.exitCode).toBe(78);
    expect(result.stderr).toBe("file_upload_cleanup_worker_unavailable\n");
    expect(result.stderr).not.toContain(secret);
  });
});
