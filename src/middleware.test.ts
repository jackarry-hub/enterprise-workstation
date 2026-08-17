import { describe, expect, it } from "vitest";

import { isStandaloneAuthorizedPath } from "@/middleware";

describe("standalone workstation middleware boundary", () => {
  it("bypasses Feishu only for the fused workstation and self-authorizing APIs", () => {
    expect(isStandaloneAuthorizedPath("/quantxy-ai-workbench-fused.html")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/demo-auth/login")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/demo-auth/session")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/demo-auth/logout")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/ai/config")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/ai/chat")).toBe(true);
    expect(isStandaloneAuthorizedPath("/dashboard")).toBe(false);
    expect(isStandaloneAuthorizedPath("/login")).toBe(false);
  });
});
