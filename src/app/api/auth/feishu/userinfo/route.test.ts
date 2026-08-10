import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/auth/feishu/userinfo/route";

describe("Feishu UserInfo route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a stable public error when auth configuration is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("FEISHU_TENANT_KEY", "");

    const response = await GET(
      new Request("https://brain.quantxy.com/api/auth/feishu/userinfo", {
        headers: { Authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_misconfigured" });
  });
});
