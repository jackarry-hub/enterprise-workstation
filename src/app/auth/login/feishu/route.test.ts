import { afterEach, describe, expect, it, vi } from "vitest";

import { createOAuthStartHandler } from "@/app/auth/login/feishu/handler";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Feishu OAuth start route", () => {
  it("sets one callback-scoped secure nonce cookie and never redirects with the raw nonce", async () => {
    const nonce = "x".repeat(43);
    const response = await createOAuthStartHandler({
      getLoginUrl: async () => ({
        url: "https://accounts.feishu.cn/authorize?state=provider-state",
        nonce,
        maxAge: 600,
      }),
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
    })(new Request("http://0.0.0.0:3000/auth/login/feishu"));

    expect(response.headers.get("location")).toBe(
      "https://work.quantumgalaxy.top/access-pending?reason=auth_error",
    );
  });

  it("keeps the fused workstation as the post-login destination", async () => {
    const getLoginUrl = vi.fn().mockResolvedValue({ url: "https://accounts.feishu.cn/authorize", nonce: "n".repeat(43), maxAge: 600 });
    const response = await createOAuthStartHandler({ getLoginUrl })(
      new Request("http://localhost:3012/auth/login/feishu?next=%2Fquantxy-ai-workbench-fused.html"),
    );

    expect(getLoginUrl).toHaveBeenCalledWith("/quantxy-ai-workbench-fused.html");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://accounts.feishu.cn/authorize");
  });

  it("drops external return targets", async () => {
    const getLoginUrl = vi.fn().mockResolvedValue({ url: "https://accounts.feishu.cn/authorize", nonce: "n".repeat(43), maxAge: 600 });
    await createOAuthStartHandler({ getLoginUrl })(
      new Request("http://localhost:3012/auth/login/feishu?next=https%3A%2F%2Fevil.example"),
    );
    expect(getLoginUrl).toHaveBeenCalledWith(null);
  });
});
