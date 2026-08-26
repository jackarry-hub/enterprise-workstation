import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "@/instrumentation";

describe("server instrumentation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails Node startup when production enables demo authentication", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKSTATION_DEMO_ENABLED", "true");

    expect(() => register()).toThrow("commercial_runtime_rejects_demo");
  });
});
