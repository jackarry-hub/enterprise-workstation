function envFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on";
}

export function isDemoAuthEnabled(env: NodeJS.ProcessEnv = process.env) {
  return envFlag(env.WORKSTATION_DEMO_ENABLED);
}

export function isServerPreviewEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== "production" && isDemoAuthEnabled(env);
}

export function isLocalPreviewHost(hostname: string) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]";
}

export function shouldAllowMockBusinessData(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.NODE_ENV === "production") return false;
  if (
    envFlag(env.WORKSTATION_ALLOW_MOCK_DATA)
    || envFlag(env.NEXT_PUBLIC_WORKSTATION_ALLOW_MOCK_DATA)
  ) {
    return true;
  }
  return true;
}
