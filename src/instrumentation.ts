import { assertCommercialRuntime } from "@/features/commercial/production-mode";

export function register(): void {
  assertCommercialRuntime(process.env);
}
