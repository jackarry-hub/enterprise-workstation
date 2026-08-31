type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const REQUIRED_VALUES = [
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "KNOWLEDGE_PROCESSOR_URL",
  "KNOWLEDGE_PROCESSOR_ALLOWED_HOSTS",
] as const;

const REQUIRED_LONG_SECRETS = [
  "FEISHU_DIRECTORY_SYNC_CRON_SECRET",
  "AGENT_INVOCATION_RECOVERY_CRON_SECRET",
  "TASK_NOTIFICATION_RECOVERY_CRON_SECRET",
  "FILE_UPLOAD_CLEANUP_CRON_SECRET",
  "INTERNAL_WORKER_TOKEN",
  "KNOWLEDGE_PROCESSOR_SECRET",
] as const;

function invalidValue(value: string | undefined) {
  return !value || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value);
}

function validEncryptionKey(value: string | undefined) {
  if (invalidValue(value) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value!) || value!.length % 4 !== 0) return false;
  return Buffer.from(value!, "base64").length === 32;
}

function validProcessorTarget(rawUrl: string, rawHosts: string) {
  try {
    const url = new URL(rawUrl);
    const hosts = rawHosts.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && hosts.length > 0
      && hosts.every((host) => /^[a-z0-9.-]+$/.test(host) && !host.startsWith(".") && !host.endsWith("."))
      && hosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function assertCommercialServerRuntimeConfiguration(
  environment: RuntimeEnvironment = process.env,
) {
  if (REQUIRED_VALUES.some((key) => invalidValue(environment[key]))) {
    throw new Error("readiness_configuration_missing");
  }
  if (REQUIRED_LONG_SECRETS.some((key) => {
    const value = environment[key];
    return invalidValue(value) || value!.length < 32 || value!.length > 512;
  })) throw new Error("readiness_configuration_missing");
  if (!validEncryptionKey(environment.AI_CONFIG_ENCRYPTION_KEY)) {
    throw new Error("readiness_configuration_missing");
  }
  if (!validProcessorTarget(
    environment.KNOWLEDGE_PROCESSOR_URL!,
    environment.KNOWLEDGE_PROCESSOR_ALLOWED_HOSTS!,
  )) throw new Error("readiness_configuration_missing");
}
