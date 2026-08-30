import { afterEach, describe, expect, it, vi } from "vitest";

import { createOAuthStartHandler } from "@/app/auth/login/feishu/handler";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Feishu OAuth start route", () => {
  const allowed = async () => ({
    allowed: true,
    remaining: 9,
    resetAt: "2026-08-30T12:01:00.000Z",
    retryAfter: 0,
    lockedUntil: null,
  });

  it("sets one callback-scoped secure nonce cookie and never redirects with the raw nonce", async () => {
    const nonce = "x".repeat(43);
    const response = await createOAuthStartHandler({
      getLoginUrl: async () => ({
        url: "https://accounts.feishu.cn/authorize?state=provider-state",
        nonce,
        maxAge: 600,
      }),
      consumeLoginAttempt: allowed,
    })(new Request("https://work.quantxy.test/auth/login/feishu?next=%2Fpeople"));

    expect(response.status).toBe(307);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).not.toContain(nonce);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("qx_feishu_oauth_nonce=");
    expect(cookie).toContain("Path=/auth/callback");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("uses the configured public origin when OAuth startup fails behind the reverse proxy", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://work.quantumgalaxy.top");

    const response = await createOAuthStartHandler({
      getLoginUrl: async () => null,
      consumeLoginAttempt: allowed,
    })(new Request("http://0.0.0.0:3000/auth/login/feishu"));

    expect(response.headers.get("location")).toBe(
      "https://work.quantumgalaxy.top/access-pending?reason=auth_error",
    );
  });

  it("keeps a commercial workspace page as the post-login destination", async () => {
    const getLoginUrl = vi.fn().mockResolvedValue({ url: "https://accounts.feishu.cn/authorize", nonce: "n".repeat(43), maxAge: 600 });
    const response = await createOAuthStartHandler({ getLoginUrl, consumeLoginAttempt: allowed })(
      new Request("http://localhost:3012/auth/login/feishu?next=%2Fagents"),
    );

    expect(getLoginUrl).toHaveBeenCalledWith("/agents");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://accounts.feishu.cn/authorize");
  });

  it("drops external return targets", async () => {
    const getLoginUrl = vi.fn().mockResolvedValue({ url: "https://accounts.feishu.cn/authorize", nonce: "n".repeat(43), maxAge: 600 });
    await createOAuthStartHandler({ getLoginUrl, consumeLoginAttempt: allowed })(
      new Request("http://localhost:3012/auth/login/feishu?next=https%3A%2F%2Fevil.example"),
    );
    expect(getLoginUrl).toHaveBeenCalledWith(null);
  });

  it("drops the quarantined fused return target", async () => {
    const getLoginUrl = vi.fn().mockResolvedValue({ url: "https://accounts.feishu.cn/authorize", nonce: "n".repeat(43), maxAge: 600 });
    await createOAuthStartHandler({ getLoginUrl, consumeLoginAttempt: allowed })(
      new Request("http://localhost:3012/auth/login/feishu?next=%2Fquantxy-ai-workbench-fused.html"),
    );
    expect(getLoginUrl).toHaveBeenCalledWith(null);
  });

  it("returns 429 before contacting Feishu when the persistent limiter locks login abuse", async () => {
    const getLoginUrl = vi.fn();
    const response = await createOAuthStartHandler({
      getLoginUrl,
      consumeLoginAttempt: async () => ({
        allowed: false,
        remaining: 0,
        resetAt: "2026-08-30T12:02:00.000Z",
        retryAfter: 120,
        lockedUntil: "2026-08-30T12:02:00.000Z",
      }),
    })(new Request("https://work.quantxy.test/auth/login/feishu"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(getLoginUrl).not.toHaveBeenCalled();
  });

  it("fails closed when the distributed limiter is unavailable and recovers on a later allowed request", async () => {
    const getLoginUrl = vi.fn().mockResolvedValue({ url: "https://accounts.feishu.cn/authorize", nonce: "n".repeat(43), maxAge: 600 });
    const unavailable = await createOAuthStartHandler({
      getLoginUrl,
      consumeLoginAttempt: async () => { throw new Error("private database detail"); },
    })(new Request("https://work.quantxy.test/auth/login/feishu"));
    expect(unavailable.status).toBe(503);
    expect(getLoginUrl).not.toHaveBeenCalled();

    const recovered = await createOAuthStartHandler({ getLoginUrl, consumeLoginAttempt: allowed })(
      new Request("https://work.quantxy.test/auth/login/feishu"),
    );
    expect(recovered.status).toBe(307);
  });
});
