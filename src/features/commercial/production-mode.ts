export function assertCommercialRuntime(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production" && env.WORKSTATION_DEMO_ENABLED === "true") {
    throw new Error("commercial_runtime_rejects_demo");
  }
}
