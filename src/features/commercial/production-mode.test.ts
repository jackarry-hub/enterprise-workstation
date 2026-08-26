import { describe, expect, it } from "vitest";

import { assertCommercialRuntime } from "@/features/commercial/production-mode";

function env(values: Record<string, string | undefined>) {
  return values as NodeJS.ProcessEnv;
}

describe("assertCommercialRuntime", () => {
  it.each(["true", "1", "yes", "on"])(
    "rejects production when the real demo gate is enabled with %s",
    (demoSetting) => {
      expect(() => assertCommercialRuntime(env({
        NODE_ENV: "production",
        WORKSTATION_DEMO_ENABLED: demoSetting,
      }))).toThrow("commercial_runtime_rejects_demo");
    },
  );

  it("permits non-production and production without demo authentication", () => {
    expect(() => assertCommercialRuntime(env({
      NODE_ENV: "development",
      WORKSTATION_DEMO_ENABLED: "true",
    }))).not.toThrow();
    expect(() => assertCommercialRuntime(env({
      NODE_ENV: "production",
      WORKSTATION_DEMO_ENABLED: "false",
    }))).not.toThrow();
  });
});
