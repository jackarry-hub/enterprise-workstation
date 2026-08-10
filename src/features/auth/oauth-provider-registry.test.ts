import { describe, expect, it } from "vitest";

import {
  getEnabledOAuthProvider,
  type OAuthProviderDefinition,
} from "@/features/auth/oauth-provider-registry";

describe("OAuth provider registry", () => {
  it("resolves the enabled Feishu provider used by the login action", () => {
    expect(getEnabledOAuthProvider("feishu")).toEqual({
      code: "feishu",
      label: "飞书",
      supabaseProvider: "custom:feishu",
      enabled: true,
      loginButtonLabel: "使用飞书登录",
    });
  });

  it("uses one stable rejection for unknown and disabled providers", () => {
    const disabledProviders: readonly OAuthProviderDefinition[] = [
      {
        code: "disabled-provider",
        label: "已停用",
        supabaseProvider: "custom:disabled-provider",
        enabled: false,
        loginButtonLabel: "不可使用",
      },
    ];

    expect(getEnabledOAuthProvider("unknown-provider")).toBeNull();
    expect(
      getEnabledOAuthProvider("disabled-provider", disabledProviders),
    ).toBeNull();
  });
});
