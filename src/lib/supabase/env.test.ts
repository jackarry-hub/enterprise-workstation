import { afterEach, describe, expect, it, vi } from "vitest";

import { getSupabaseEnv } from "@/lib/supabase/env";

describe("getSupabaseEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports every missing public Supabase setting", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    expect(() => getSupabaseEnv()).toThrow(
      "Supabase 配置缺失：NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("returns the configured project URL and publishable key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");

    expect(getSupabaseEnv()).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_example",
    });
  });

  it.each([
    ["dashboard", "NEXT_PUBLIC_SUPABASE_URL"],
    ["file:///tmp/supabase", "NEXT_PUBLIC_SUPABASE_URL"],
    ["https://user:password@example.supabase.co", "NEXT_PUBLIC_SUPABASE_URL"],
  ])("rejects an unsafe public project URL without echoing it", (url, field) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");

    expect(() => getSupabaseEnv()).toThrow(`Supabase 配置无效：${field}`);
    try {
      getSupabaseEnv();
    } catch (error) {
      expect(String(error)).not.toContain(url);
    }
  });

  it.each(["sb_secret_example", "service_role"])(
    "rejects a secret key placed in the public key setting",
    (key) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);

      expect(() => getSupabaseEnv()).toThrow(
        "Supabase 配置无效：NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      );
      try {
        getSupabaseEnv();
      } catch (error) {
        expect(String(error)).not.toContain(key);
      }
    },
  );
});
