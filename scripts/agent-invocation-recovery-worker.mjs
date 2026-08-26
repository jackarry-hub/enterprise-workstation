import { fileURLToPath } from "node:url";

const RECOVERY_PATH = "/api/internal/agent-invocation-recovery";
const DEFAULT_RECOVERY_URL = `http://workstation:3000${RECOVERY_PATH}`;
const DEFAULT_INTERVAL_SECONDS = 300;
const MIN_INTERVAL_SECONDS = 1;
const MAX_INTERVAL_SECONDS = 86_400;

function configuredRecoveryWorker(environment) {
  const secret = environment.AGENT_INVOCATION_RECOVERY_CRON_SECRET;
  if (
    typeof secret !== "string"
    || secret.length < 32
    || secret.length > 512
    || secret.trim() !== secret
    || /[\u0000-\u001f\u007f]/.test(secret)
  ) {
    return null;
  }

  const rawUrl = environment.AGENT_INVOCATION_RECOVERY_URL ?? DEFAULT_RECOVERY_URL;
  let recoveryUrl;
  try {
    recoveryUrl = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    (recoveryUrl.protocol !== "http:" && recoveryUrl.protocol !== "https:")
    || recoveryUrl.pathname !== RECOVERY_PATH
  ) {
    return null;
  }

  const rawInterval = environment.AGENT_INVOCATION_RECOVERY_INTERVAL_SECONDS;
  const intervalSeconds = rawInterval === undefined
    ? DEFAULT_INTERVAL_SECONDS
    : Number(rawInterval);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS || intervalSeconds > MAX_INTERVAL_SECONDS) {
    return null;
  }

  return { secret, recoveryUrl: recoveryUrl.toString(), intervalSeconds };
}

function writeFailure(log, status) {
  log(`agent_invocation_recovery_request_failed status=${status}`);
}

async function executeRecovery(config, fetchImpl, log) {
  let response;
  try {
    response = await fetchImpl(config.recoveryUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${config.secret}` },
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    writeFailure(log, "network_error");
    return false;
  }
  if (response.status !== 200) {
    writeFailure(log, response.status);
    return false;
  }
  return true;
}

export async function runAgentInvocationRecoveryOnce({
  environment = process.env,
  fetchImpl = fetch,
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const config = configuredRecoveryWorker(environment);
  if (!config) {
    log("agent_invocation_recovery_worker_unavailable");
    return false;
  }
  return executeRecovery(config, fetchImpl, log);
}

async function main() {
  const config = configuredRecoveryWorker(process.env);
  if (!config) {
    process.stderr.write("agent_invocation_recovery_worker_unavailable\n");
    return 78;
  }
  if (process.argv[2] === "--once") {
    return (await executeRecovery(config, fetch, (message) => process.stderr.write(`${message}\n`))) ? 0 : 1;
  }
  if (process.argv[2] !== undefined) {
    process.stderr.write("agent_invocation_recovery_worker_invalid_argument\n");
    return 64;
  }
  for (;;) {
    await executeRecovery(config, fetch, (message) => process.stderr.write(`${message}\n`));
    await new Promise((resolve) => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((exitCode) => { process.exitCode = exitCode; });
}
