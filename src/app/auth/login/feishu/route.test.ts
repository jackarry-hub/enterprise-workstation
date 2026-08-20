import { afterEach, describe, expect, it, vi } from "vitest";

import { createOAuthStartHandler } from "@/app/auth/login/feishu/handler";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Feishu OAuth start route", () => {
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
    const getLoginUrl = vi.fn().mockResolvedValue("https://accounts.feishu.cn/authorize");
    const response = await createOAuthStartHandler({ getLoginUrl })(
      new Request("http://localhost:3012/auth/login/feishu?next=%2Fquantxy-ai-workbench-fused.html"),
    );

    expect(getLoginUrl).toHaveBeenCalledWith("/quantxy-ai-workbench-fused.html");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://accounts.feishu.cn/authorize");
  });

  it("drops external return targets", async () => {
    const getLoginUrl = vi.fn().mockResolvedValue("https://accounts.feishu.cn/authorize");
    await createOAuthStartHandler({ getLoginUrl })(
      new Request("http://localhost:3012/auth/login/feishu?next=https%3A%2F%2Fevil.example"),
    );
    expect(getLoginUrl).toHaveBeenCalledWith(null);
  });
});
