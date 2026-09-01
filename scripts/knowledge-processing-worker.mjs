import { fileURLToPath } from "node:url";

const PROCESSING_PATH = "/api/internal/knowledge-processing";
const DEFAULT_PROCESSING_URL = `http://workstation:3000${PROCESSING_PATH}`;
const DEFAULT_INTERVAL_SECONDS = 10;

function configuredWorker(environment) {
  const secret = environment.INTERNAL_WORKER_TOKEN;
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 512
      || secret.trim() !== secret || /[\u0000-\u001f\u007f]/.test(secret)) return null;
  let processingUrl;
  try { processingUrl = new URL(environment.KNOWLEDGE_PROCESSING_URL ?? DEFAULT_PROCESSING_URL); } catch { return null; }
  const internalHttp = processingUrl.protocol === "http:"
    && ["workstation", "127.0.0.1", "localhost", "::1"].includes(processingUrl.hostname);
  if (!(internalHttp || processingUrl.protocol === "https:") || processingUrl.pathname !== PROCESSING_PATH
      || processingUrl.username || processingUrl.password || processingUrl.search || processingUrl.hash) return null;
  const intervalSeconds = environment.KNOWLEDGE_PROCESSING_INTERVAL_SECONDS === undefined
    ? DEFAULT_INTERVAL_SECONDS : Number(environment.KNOWLEDGE_PROCESSING_INTERVAL_SECONDS);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 3_600) return null;
  return { secret, processingUrl: processingUrl.toString(), intervalSeconds };
}

async function execute(config, fetchImpl, log) {
  try {
    const response = await fetchImpl(config.processingUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${config.secret}` },
      redirect: "manual",
      signal: AbortSignal.timeout(175_000),
    });
    if (response.status === 200) return true;
    log(`knowledge_processing_request_failed status=${response.status}`);
  } catch {
    log("knowledge_processing_request_failed status=network_error");
  }
  return false;
}

export async function runKnowledgeProcessingOnce({
  environment = process.env,
  fetchImpl = fetch,
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const config = configuredWorker(environment);
  if (!config) {
    log("knowledge_processing_worker_unavailable");
    return false;
  }
  return execute(config, fetchImpl, log);
}

async function main() {
  const config = configuredWorker(process.env);
  if (!config) {
    process.stderr.write("knowledge_processing_worker_unavailable\n");
    return 78;
  }
  if (process.argv[2] === "--once") return (await execute(config, fetch, (message) => process.stderr.write(`${message}\n`))) ? 0 : 1;
  if (process.argv[2] !== undefined) {
    process.stderr.write("knowledge_processing_worker_invalid_argument\n");
    return 64;
  }
  for (;;) {
    await execute(config, fetch, (message) => process.stderr.write(`${message}\n`));
    await new Promise((resolve) => setTimeout(resolve, config.intervalSeconds * 1_000));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((exitCode) => { process.exitCode = exitCode; });
}
