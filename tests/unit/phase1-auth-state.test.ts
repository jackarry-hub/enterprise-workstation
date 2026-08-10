import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertLocalSupabaseUrl,
  authStatePath,
  getAuthHarnessEnvironment,
  roleFixtures,
} from "../e2e/auth-state";

describe("Phase 1 Playwright auth-state contract", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321/",
    "http://[::1]:54321",
  ])("accepts the local Supabase host %s", (url) => {
    expect(assertLocalSupabaseUrl(url)).toBe(new URL(url).origin);
  });

  it.each([
    "https://project.supabase.co",
    "http://127.0.0.2:54321",
    "file:///tmp/supabase",
    "not-a-url",
    "http://user:password@127.0.0.1:54321",
  ])("rejects the remote or malformed Supabase URL %s", (url) => {
    expect(() => assertLocalSupabaseUrl(url)).toThrow(
      "E2E 只允许连接本机 Supabase",
    );
  });

  it("validates the local URL before reading any secret value", () => {
    let secretRead = false;
    const env = new Proxy(
      {
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      } as NodeJS.ProcessEnv,
      {
        get(target, property, receiver) {
          if (property === "SUPABASE_SERVICE_ROLE_KEY") secretRead = true;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    expect(() => getAuthHarnessEnvironment(env)).toThrow(
      "E2E 只允许连接本机 Supabase",
    );
    expect(secretRead).toBe(false);
  });

  it("keeps one ignored storage-state file per workspace role", () => {
    expect(authStatePath("executive")).toBe(
      path.resolve("playwright", ".auth", "executive.json"),
    );
    expect(new Set(Object.values(roleFixtures).map(({ state }) => state)).size).toBe(5);
  });

  it("uses provider-neutral typed identity claims for every role fixture", () => {
    for (const fixture of Object.values(roleFixtures)) {
      expect(fixture.providerSubject).toMatch(/^open_id:/);
      expect(fixture.providerMatchKeys).toContain(fixture.providerSubject);
      expect(fixture.providerMatchKeys.some((key) => key.startsWith("email:"))).toBe(true);
    }
  });
});
