import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDemoAuthEnv,
  verifyDemoCredentials,
} from "@/features/demo-auth/demo-auth-env";

describe("demo auth environment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects missing server credentials without echoing submitted values", () => {
    vi.stubEnv("WORKSTATION_DEMO_ENABLED", "true");
    vi.stubEnv("WORKSTATION_DEMO_PASSWORD", "");
    vi.stubEnv("WORKSTATION_DEMO_TENANT_ID", "");
    vi.stubEnv("AI_CONFIG_ENCRYPTION_KEY", "");

    expect(() => getDemoAuthEnv()).toThrow("WORKSTATION_DEMO_PASSWORD");
  });

  it("rejects demo credentials unless demo auth is explicitly enabled", () => {
    vi.stubEnv("WORKSTATION_DEMO_USERNAME", "admin");
    vi.stubEnv("WORKSTATION_DEMO_PASSWORD", "correct-horse-battery");
    vi.stubEnv(
      "WORKSTATION_DEMO_TENANT_ID",
      "10000000-0000-4000-8000-000000000000",
    );
    vi.stubEnv(
      "AI_CONFIG_ENCRYPTION_KEY",
      Buffer.alloc(32, 9).toString("base64"),
    );

    expect(() => getDemoAuthEnv()).toThrow("WORKSTATION_DEMO_ENABLED");
  });

  it("accepts a tenant-scoped deployment credential and verifies it", () => {
    vi.stubEnv("WORKSTATION_DEMO_ENABLED", "true");
    vi.stubEnv("WORKSTATION_DEMO_USERNAME", "admin");
    vi.stubEnv("WORKSTATION_DEMO_PASSWORD", "correct-horse-battery");
    vi.stubEnv(
      "WORKSTATION_DEMO_TENANT_ID",
      "10000000-0000-4000-8000-000000000000",
    );
    vi.stubEnv(
      "AI_CONFIG_ENCRYPTION_KEY",
      Buffer.alloc(32, 9).toString("base64"),
    );

    const env = getDemoAuthEnv();

    expect(env.username).toBe("admin");
    expect(env.tenantId).toBe("10000000-0000-4000-8000-000000000000");
    expect(env.signingKey).toHaveLength(32);
    expect(verifyDemoCredentials("admin", "correct-horse-battery", env)).toBe(true);
    expect(verifyDemoCredentials("admin", "wrong-password", env)).toBe(false);
  });
});
