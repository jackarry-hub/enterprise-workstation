import { isDemoAuthEnabled } from "@/lib/runtime/workstation-mode";

export function assertCommercialRuntime(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production" && isDemoAuthEnabled(env)) {
    throw new Error("commercial_runtime_rejects_demo");
  }
}
