import { describe, expect, it } from "vitest";

import { createOAuthStart } from "@/features/auth/oauth-start";

describe("controlled OAuth start", () => {
  it("binds the durable attempt ID to Supabase PKCE without placing the nonce in a URL", async () => {
    const signIn = async (redirectTo: string) => ({
      url: `https://accounts.feishu.cn/authorize?redirect_uri=${encodeURIComponent(redirectTo)}`,
    });
    const result = await createOAuthStart("feishu", "/people", {
      createAttempt: async () => ({
        attemptId: "77000000-0000-4000-8000-000000000001",
        nonce: "n".repeat(43),
        returnPath: "/people",
        maxAge: 600,
      }),
      signIn,
      appUrl: "https://work.quantxy.test",
    });

    expect(result?.url).toContain("accounts.feishu.cn");
    expect(decodeURIComponent(result?.url ?? "")).toContain("attempt=77000000-0000-4000-8000-000000000001");
    expect(result?.url).not.toContain("n".repeat(43));
    expect(result?.nonce).toBe("n".repeat(43));
  });
});
