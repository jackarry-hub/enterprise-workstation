import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  type AuthCallbackDependencies,
  type IdentityClaimResult,
} from "@/app/auth/callback/route";

const callbackOrigin = "https://brain.quantxy.com";
const { handleAuthCallback } = GET;
const attemptId = "77000000-0000-4000-8000-000000000001";
const nonce = "n".repeat(43);

function callbackRequest(input: string | URL) {
  const url = new URL(input);
  if (!url.searchParams.has("attempt")) url.searchParams.set("attempt", attemptId);
  return new Request(url, { headers: { cookie: `qx_feishu_oauth_nonce=${nonce}` } });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

function dependencies(
  overrides: Partial<AuthCallbackDependencies> = {},
): AuthCallbackDependencies {
  return {
    consumeAttempt: async () => true,
    exchangeCode: async () => "auth-user-id",
    claimIdentity: async () => "active",
    loadSession: async () => ({ landingPath: "/execution" }),
    signOut: async () => undefined,
    ...overrides,
  };
}

describe("handleAuthCallback", () => {
  it("rejects a missing, mismatched or replayed application attempt before code exchange", async () => {
    const exchangeCode = vi.fn(async () => "auth-user-id");
    const response = await handleAuthCallback(
      callbackRequest(`${callbackOrigin}/auth/callback?code=one-time-code&attempt=77000000-0000-4000-8000-000000000001`),
      dependencies({ consumeAttempt: async () => false, exchangeCode }),
    );

    expect(exchangeCode).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${callbackOrigin}/access-pending?reason=auth_error`);
    expect(response.headers.get("set-cookie")).toMatch(/qx_feishu_oauth_nonce=;/);
  });

  it("rejects a malformed percent-encoded nonce cookie with stable cleanup", async () => {
    const exchangeCode = vi.fn(async () => "auth-user-id");
    const response = await handleAuthCallback(
      new Request(`${callbackOrigin}/auth/callback?attempt=${attemptId}&code=one-time-code`, {
        headers: { cookie: "qx_feishu_oauth_nonce=%E0%A4%A" },
      }),
      dependencies({ exchangeCode }),
    );
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${callbackOrigin}/access-pending?reason=auth_error`);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("uses the configured public origin when the reverse proxy exposes the container origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://work.quantumgalaxy.top");

    const response = await handleAuthCallback(
      callbackRequest("http://0.0.0.0:3000/auth/callback?code=one-time-code"),
      dependencies({ claimIdentity: async () => "not_provisioned" }),
    );

    expect(response.headers.get("location")).toBe(
      "https://work.quantumgalaxy.top/access-pending?reason=not_provisioned",
    );
  });

  it("exchanges one code and redirects an active identity to the role workspace", async () => {
    const exchangeCode = vi.fn(async () => "auth-user-id");
    const response = await handleAuthCallback(
      callbackRequest(`${callbackOrigin}/auth/callback?code=one-time-code`),
      dependencies({ exchangeCode }),
    );

    expect(exchangeCode).toHaveBeenCalledOnce();
    expect(exchangeCode).toHaveBeenCalledWith("one-time-code");
    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/execution`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("loads workspace access for the user returned by the code exchange", async () => {
    const loadSession = vi.fn(async (authUserId: string) =>
      authUserId === "auth-user-id" ? { landingPath: "/execution" } : null,
    );
    const response = await handleAuthCallback(
      callbackRequest(`${callbackOrigin}/auth/callback?code=one-time-code`),
      dependencies({ loadSession }),
    );

    expect(loadSession).toHaveBeenCalledOnce();
    expect(loadSession).toHaveBeenCalledWith("auth-user-id");
    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/execution`,
    );
  });

  it.each([
    ["not_provisioned", "not_provisioned"],
    ["suspended", "suspended"],
    ["departed", "departed"],
    ["revoked", "revoked"],
    ["invalid_identity", "identity_error"],
    ["identity_conflict", "identity_error"],
    ["unauthenticated", "auth_error"],
  ] as const)(
    "signs out rejected identity %s using public reason %s",
    async (claimResult, publicReason) => {
      const signOut = vi.fn(async () => undefined);
      const response = await handleAuthCallback(
        callbackRequest(`${callbackOrigin}/auth/callback?code=one-time-code`),
        dependencies({
          claimIdentity: async () => claimResult,
          signOut,
        }),
      );

      expect(signOut).toHaveBeenCalledOnce();
      expect(response.headers.get("location")).toBe(
        `${callbackOrigin}/access-pending?reason=${publicReason}`,
      );
      if (claimResult === "revoked") {
        expect(response.headers.get("location")).not.toContain(
          "reason=suspended",
        );
      }
    },
  );

  it.each([
    `${callbackOrigin}/auth/callback`,
    `${callbackOrigin}/auth/callback?code=first&code=second`,
  ])("rejects a callback without exactly one code: %s", async (url) => {
    const exchangeCode = vi.fn(async () => "auth-user-id");
    const signOut = vi.fn(async () => undefined);
    const response = await handleAuthCallback(
      callbackRequest(url),
      dependencies({ exchangeCode, signOut }),
    );

    expect(exchangeCode).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/access-pending?reason=auth_error`,
    );
  });

  it("signs out when the one-time code cannot be exchanged", async () => {
    const signOut = vi.fn(async () => undefined);
    const response = await handleAuthCallback(
      callbackRequest(`${callbackOrigin}/auth/callback?code=expired`),
      dependencies({ exchangeCode: async () => null, signOut }),
    );

    expect(signOut).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/access-pending?reason=auth_error`,
    );
  });

  it("signs out when active identity workspace access cannot be loaded", async () => {
    const signOut = vi.fn(async () => undefined);
    const response = await handleAuthCallback(
      callbackRequest(`${callbackOrigin}/auth/callback?code=one-time-code`),
      dependencies({ loadSession: async () => null, signOut }),
    );

    expect(signOut).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/access-pending?reason=identity_error`,
    );
  });

  it("uses a safe relative next path after validating workspace access", async () => {
    const response = await handleAuthCallback(
      callbackRequest(
        `${callbackOrigin}/auth/callback?code=one-time-code&next=%2Ffinance%3Ftab%3Dmonth`,
      ),
      dependencies(),
    );

    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/finance?tab=month`,
    );
  });

  it("uses the return path consumed from durable state instead of callback query input", async () => {
    const response = await handleAuthCallback(
      callbackRequest(`${callbackOrigin}/auth/callback?code=one-time-code&next=%2Ffinance`),
      dependencies({ consumeAttempt: async () => ({ valid: true, returnPath: "/people" }) }),
    );
    expect(response.headers.get("location")).toBe(`${callbackOrigin}/people`);
  });

  it("does not accept a callback query destination when durable state stored no return path", async () => {
    const response = await handleAuthCallback(
      callbackRequest(`${callbackOrigin}/auth/callback?code=one-time-code&next=%2Ffinance`),
      dependencies({ consumeAttempt: async () => ({ valid: true, returnPath: null }) }),
    );
    expect(response.headers.get("location")).toBe(`${callbackOrigin}/execution`);
  });

  it.each([
    "https%3A%2F%2Fevil.example%2Fsteal",
    "%2F%2Fevil.example%2Fsteal",
    "%252F%252Fevil.example%252Fsteal",
  ])("ignores an unsafe next path: %s", async (next) => {
    const response = await handleAuthCallback(
      callbackRequest(
        `${callbackOrigin}/auth/callback?code=one-time-code&next=${next}`,
      ),
      dependencies(),
    );

    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/execution`,
    );
  });

  it("never exposes an unknown claim or sensitive diagnostic text", async () => {
    const signOut = vi.fn(async () => undefined);
    const response = await handleAuthCallback(
      callbackRequest(`${callbackOrigin}/auth/callback?code=one-time-code`),
      dependencies({
        claimIdentity: async () =>
          "open_id union_id tenant_key provider_token SQL error" as IdentityClaimResult,
        signOut,
      }),
    );
    const location = response.headers.get("location") ?? "";

    expect(signOut).toHaveBeenCalledOnce();
    expect(location).toBe(
      `${callbackOrigin}/access-pending?reason=identity_error`,
    );
    expect(location).not.toMatch(
      /open_id|union_id|tenant_key|provider[_ ]token|sql/i,
    );
  });

  it.each([
    ["constructor", "constructor"],
    ["toString", "toString"],
    ["__proto__", "__proto__"],
    ["unknown string", "unknown_claim"],
    ["number", 42],
    ["object", { technical: "database detail" }],
    ["null", null],
  ])(
    "maps unsafe claim value %s to identity_error and signs out",
    async (_label, claimResult) => {
      const signOut = vi.fn(async () => undefined);
      const response = await handleAuthCallback(
        callbackRequest(`${callbackOrigin}/auth/callback?code=one-time-code`),
        dependencies({
          claimIdentity: async () => claimResult,
          signOut,
        }),
      );

      expect(signOut).toHaveBeenCalledOnce();
      expect(response.headers.get("location")).toBe(
        `${callbackOrigin}/access-pending?reason=identity_error`,
      );
    },
  );

  it("maps callback dependency failures to a stable auth error and signs out", async () => {
    const signOut = vi.fn(async () => undefined);
    const response = await handleAuthCallback(
      callbackRequest(`${callbackOrigin}/auth/callback?code=one-time-code`),
      dependencies({
        claimIdentity: async () => {
          throw new Error("sensitive upstream detail");
        },
        signOut,
      }),
    );

    expect(signOut).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/access-pending?reason=auth_error`,
    );
  });
});
