import { fileURLToPath } from "node:url";

const CLEANUP_PATH = "/api/internal/file-upload-cleanup";
const DEFAULT_CLEANUP_URL = `http://workstation:3000${CLEANUP_PATH}`;
const DEFAULT_INTERVAL_SECONDS = 900;
const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 86_400;

function configuredWorker(environment) {
  const secret = environment.FILE_UPLOAD_CLEANUP_CRON_SECRET;
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 512
      || secret.trim() !== secret || /[\u0000-\u001f\u007f]/.test(secret)) return null;
  let cleanupUrl;
  try {
    cleanupUrl = new URL(environment.FILE_UPLOAD_CLEANUP_URL ?? DEFAULT_CLEANUP_URL);
  } catch {
    return null;
  }
  const internalHttp = cleanupUrl.protocol === "http:"
    && ["workstation", "127.0.0.1", "localhost", "::1"].includes(cleanupUrl.hostname);
  if (!(internalHttp || cleanupUrl.protocol === "https:") || cleanupUrl.pathname !== CLEANUP_PATH
      || cleanupUrl.username || cleanupUrl.password || cleanupUrl.search || cleanupUrl.hash) return null;
  const rawInterval = environment.FILE_UPLOAD_CLEANUP_INTERVAL_SECONDS;
  const intervalSeconds = rawInterval === undefined ? DEFAULT_INTERVAL_SECONDS : Number(rawInterval);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS
      || intervalSeconds > MAX_INTERVAL_SECONDS) return null;
  return { secret, cleanupUrl: cleanupUrl.toString(), intervalSeconds };
}

async function execute(config, fetchImpl, log) {
  let response;
  try {
    response = await fetchImpl(config.cleanupUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${config.secret}` },
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    log("file_upload_cleanup_request_failed status=network_error");
    return false;
  }
  if (response.status !== 200) {
    log(`file_upload_cleanup_request_failed status=${response.status}`);
    return false;
  }
  return true;
}

export async function runFileUploadCleanupOnce({
  environment = process.env,
  fetchImpl = fetch,
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const config = configuredWorker(environment);
  if (!config) {
    log("file_upload_cleanup_worker_unavailable");
    return false;
  }
  return execute(config, fetchImpl, log);
}

async function main() {
  const config = configuredWorker(process.env);
  if (!config) {
    process.stderr.write("file_upload_cleanup_worker_unavailable\n");
    return 78;
  }
  if (process.argv[2] === "--once") {
    return (await execute(config, fetch, (message) => process.stderr.write(`${message}\n`))) ? 0 : 1;
  }
  if (process.argv[2] !== undefined) {
    process.stderr.write("file_upload_cleanup_worker_invalid_argument\n");
    return 64;
  }
  for (;;) {
    await execute(config, fetch, (message) => process.stderr.write(`${message}\n`));
    await new Promise((resolve) => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((exitCode) => { process.exitCode = exitCode; });
}
