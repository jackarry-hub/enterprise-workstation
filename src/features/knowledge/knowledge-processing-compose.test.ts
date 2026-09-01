// @vitest-environment node

import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

const workerScript = resolve(process.cwd(), "scripts/knowledge-processing-worker.mjs");
const compose = readFileSync(resolve(process.cwd(), "compose.yaml"), "utf8");
const secret = "knowledge-processing-worker-secret-not-for-logs";

function runWorker(environment: NodeJS.ProcessEnv) {
  return new Promise<{ exitCode: number | null; stderr: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, [workerScript, "--once"], { env: environment, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (exitCode) => resolveResult({ exitCode, stderr }));
  });
}

async function runWorkerOnce(status: number) {
  const server = createServer((_request, response) => {
    response.writeHead(status);
    response.end("response bodies and secrets must never reach logs");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test_server_unavailable");
  try {
    return await runWorker({
      ...process.env,
      INTERNAL_WORKER_TOKEN: secret,
      KNOWLEDGE_PROCESSING_URL: `http://127.0.0.1:${address.port}/api/internal/knowledge-processing`,
    });
  } finally {
    server.close();
    await once(server, "close");
  }
}

describe("knowledge processing Compose worker", () => {
  it("accepts only HTTP 200 and never logs bodies or secrets", async () => {
    expect(await runWorkerOnce(200)).toEqual({ exitCode: 0, stderr: "" });
    const failed = await runWorkerOnce(503);
    expect(failed).toEqual({ exitCode: 1, stderr: "knowledge_processing_request_failed status=503\n" });
    expect(failed.stderr).not.toContain(secret);
  });

  it("wires a dedicated worker and mature isolated dependencies", () => {
    expect(compose).toContain("knowledge-processing:");
    expect(compose).toContain("dockerfile: Dockerfile.knowledge-processing");
    expect(compose).toContain("clamav/clamav:1.5.4");
    expect(compose).toContain("quay.io/unstructured-io/unstructured-api:0.1.2");
    expect(compose).toContain("text-embeddings-inference:cpu-1.9.3");
    expect(compose.match(/^\s+INTERNAL_WORKER_TOKEN:/gm)).toHaveLength(2);
  });
});
