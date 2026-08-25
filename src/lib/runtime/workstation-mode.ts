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

export function shouldAllowMockBusinessData(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (
    envFlag(env.WORKSTATION_ALLOW_MOCK_DATA)
    || envFlag(env.NEXT_PUBLIC_WORKSTATION_ALLOW_MOCK_DATA)
  ) {
    return true;
  }
  return env.NODE_ENV !== "production";
}
