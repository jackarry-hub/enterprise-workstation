import { describe, expect, it, vi } from "vitest";

import {
  GET,
  type AuthCallbackDependencies,
  type IdentityClaimResult,
} from "@/app/auth/callback/route";

const callbackOrigin = "https://brain.quantxy.com";
const { handleAuthCallback } = GET;

function dependencies(
  overrides: Partial<AuthCallbackDependencies> = {},
): AuthCallbackDependencies {
  return {
    exchangeCode: async () => true,
    claimIdentity: async () => "active",
    loadSession: async () => ({ landingPath: "/execution" }),
    signOut: async () => undefined,
    ...overrides,
  };
}

describe("handleAuthCallback", () => {
  it("exchanges one code and redirects an active identity to its landing page", async () => {
    const exchangeCode = vi.fn(async () => true);
    const response = await handleAuthCallback(
      new Request(`${callbackOrigin}/auth/callback?code=one-time-code`),
      dependencies({ exchangeCode }),
    );

    expect(exchangeCode).toHaveBeenCalledOnce();
    expect(exchangeCode).toHaveBeenCalledWith("one-time-code");
    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/execution`,
    );
  });

  it.each([
    ["not_provisioned", "not_provisioned"],
    ["suspended", "suspended"],
    ["departed", "departed"],
    ["revoked", "suspended"],
    ["invalid_identity", "identity_error"],
    ["identity_conflict", "identity_error"],
    ["unauthenticated", "auth_error"],
  ] as const)(
    "signs out rejected identity %s using public reason %s",
    async (claimResult, publicReason) => {
      const signOut = vi.fn(async () => undefined);
      const response = await handleAuthCallback(
        new Request(`${callbackOrigin}/auth/callback?code=one-time-code`),
        dependencies({
          claimIdentity: async () => claimResult,
          signOut,
        }),
      );

      expect(signOut).toHaveBeenCalledOnce();
      expect(response.headers.get("location")).toBe(
        `${callbackOrigin}/access-pending?reason=${publicReason}`,
      );
    },
  );

  it.each([
    `${callbackOrigin}/auth/callback`,
    `${callbackOrigin}/auth/callback?code=first&code=second`,
  ])("rejects a callback without exactly one code: %s", async (url) => {
    const exchangeCode = vi.fn(async () => true);
    const signOut = vi.fn(async () => undefined);
    const response = await handleAuthCallback(
      new Request(url),
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
      new Request(`${callbackOrigin}/auth/callback?code=expired`),
      dependencies({ exchangeCode: async () => false, signOut }),
    );

    expect(signOut).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/access-pending?reason=auth_error`,
    );
  });

  it("signs out when active identity workspace access cannot be loaded", async () => {
    const signOut = vi.fn(async () => undefined);
    const response = await handleAuthCallback(
      new Request(`${callbackOrigin}/auth/callback?code=one-time-code`),
      dependencies({ loadSession: async () => null, signOut }),
    );

    expect(signOut).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/access-pending?reason=identity_error`,
    );
  });

  it("uses a safe relative next path after validating workspace access", async () => {
    const response = await handleAuthCallback(
      new Request(
        `${callbackOrigin}/auth/callback?code=one-time-code&next=%2Ffinance%3Ftab%3Dmonth`,
      ),
      dependencies(),
    );

    expect(response.headers.get("location")).toBe(
      `${callbackOrigin}/finance?tab=month`,
    );
  });

  it.each([
    "https%3A%2F%2Fevil.example%2Fsteal",
    "%2F%2Fevil.example%2Fsteal",
    "%252F%252Fevil.example%252Fsteal",
  ])("ignores an unsafe next path: %s", async (next) => {
    const response = await handleAuthCallback(
      new Request(
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
      new Request(`${callbackOrigin}/auth/callback?code=one-time-code`),
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

  it("maps callback dependency failures to a stable auth error and signs out", async () => {
    const signOut = vi.fn(async () => undefined);
    const response = await handleAuthCallback(
      new Request(`${callbackOrigin}/auth/callback?code=one-time-code`),
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
