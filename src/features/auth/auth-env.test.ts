import { describe, expect, it } from "vitest";
import { getAuthEnv } from "@/features/auth/auth-env";

describe("auth environment", () => {
  it("requires an absolute app URL and a Feishu tenant key", () => {
    expect(() => getAuthEnv({})).toThrow("认证配置缺失");
    expect(() =>
      getAuthEnv({
        NEXT_PUBLIC_APP_URL: "dashboard",
        FEISHU_TENANT_KEY: "tenant",
      }),
    ).toThrow("应用地址必须使用 http 或 https");
  });

  it("returns only non-secret runtime values", () => {
    expect(
      getAuthEnv({
        NEXT_PUBLIC_APP_URL: "https://brain.quantxy.com",
        FEISHU_TENANT_KEY: "tenant_qxy",
      }),
    ).toEqual({
      appUrl: "https://brain.quantxy.com",
      feishuTenantKey: "tenant_qxy",
    });
  });
});
