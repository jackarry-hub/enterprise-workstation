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
    ["http://localhost", "http://localhost"],
    ["http://localhost:54321", "http://localhost:54321"],
    ["http://127.0.0.1", "http://127.0.0.1"],
    ["http://127.0.0.1:54321", "http://127.0.0.1:54321"],
    ["http://[::1]", "http://[::1]"],
    ["http://[::1]:54321", "http://[::1]:54321"],
  ])(
    "allows cleartext HTTP for exact local loopback authority %s",
    (url, expectedUrl) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "sb_publishable_example",
      );

      expect(getSupabaseEnv()).toEqual({
        url: expectedUrl,
        publishableKey: "sb_publishable_example",
      });
    },
  );

  it.each([
    "http://example.supabase.co",
    "http://192.168.1.20:54321",
    "http://10.0.0.5:54321",
    "http://172.16.0.5:54321",
    "http://LOCALHOST:54321",
    "http://local%68ost:54321",
    "http://supabase.localhost:54321",
    "http://localhost.example.com:54321",
    "http://localhost.:54321",
    "http://127.1:54321",
    "http://127.0.1:54321",
    "http://127.000.000.001:54321",
    "http://2130706433:54321",
    "http://0x7f000001:54321",
    "http://017700000001:54321",
    "http://127.0.0.2:54321",
    "http://[0:0:0:0:0:0:0:1]:54321",
    "http://[::ffff:127.0.0.1]:54321",
    "http://user@localhost:54321",
    "http://localhost@evil.example:54321",
  ])(
    "rejects cleartext HTTP for non-allowlisted hostname %s",
    (url) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "sb_publishable_example",
      );

      expect(() => getSupabaseEnv()).toThrow(
        "Supabase 配置无效：NEXT_PUBLIC_SUPABASE_URL",
      );
    },
  );

  it.each([
    ["https://LOCALHOST:54321", "https://localhost:54321"],
    ["https://127.1:54321", "https://127.0.0.1:54321"],
    ["https://supabase.localhost:54321", "https://supabase.localhost:54321"],
  ])(
    "keeps HTTPS host normalization behavior unchanged for %s",
    (url, expectedUrl) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "sb_publishable_example",
      );

      expect(getSupabaseEnv()).toEqual({
        url: expectedUrl,
        publishableKey: "sb_publishable_example",
      });
    },
  );

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
