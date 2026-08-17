import { afterEach, describe, expect, it, vi } from "vitest";

import { getAiConfigEnv } from "@/features/ai-config/ai-config-env";

describe("getAiConfigEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects missing server-only AI settings", () => {
    vi.stubEnv("AI_CONFIG_ENCRYPTION_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    expect(() => getAiConfigEnv()).toThrow(
      "AI 服务端配置缺失：AI_CONFIG_ENCRYPTION_KEY, SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  it("rejects an encryption key that is not exactly 32 bytes without echoing it", () => {
    const unsafeValue = Buffer.from("too-short", "utf8").toString("base64");
    vi.stubEnv("AI_CONFIG_ENCRYPTION_KEY", unsafeValue);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-secret");

    expect(() => getAiConfigEnv()).toThrow(
      "AI 服务端配置无效：AI_CONFIG_ENCRYPTION_KEY",
    );
    try {
      getAiConfigEnv();
    } catch (error) {
      expect(String(error)).not.toContain(unsafeValue);
    }
  });

  it("returns a decoded 32-byte encryption key and service role key", () => {
    const encryptionKey = Buffer.alloc(32, 7).toString("base64");
    vi.stubEnv("AI_CONFIG_ENCRYPTION_KEY", encryptionKey);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-secret");

    const result = getAiConfigEnv();

    expect(Array.from(result.encryptionKey)).toEqual(Array(32).fill(7));
    expect(result.supabaseServiceRoleKey).toBe("service-secret");
  });
});
