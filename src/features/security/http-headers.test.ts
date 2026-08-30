import { describe, expect, it } from "vitest";

import nextConfig, { COMMERCIAL_SECURITY_HEADERS } from "../../../next.config";

describe("commercial HTTP headers", () => {
  it("applies the complete security policy to every route", async () => {
    const values = Object.fromEntries(COMMERCIAL_SECURITY_HEADERS.map(({ key, value }) => [key.toLowerCase(), value]));
    expect(values["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(values["content-security-policy"]).toContain("object-src 'none'");
    expect(values["strict-transport-security"]).toContain("includeSubDomains");
    expect(values["x-frame-options"]).toBe("DENY");
    expect(values["x-content-type-options"]).toBe("nosniff");
    expect(values["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(values["permissions-policy"]).toContain("camera=()");
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(await nextConfig.headers?.()).toEqual([{ source: "/:path*", headers: [...COMMERCIAL_SECURITY_HEADERS] }]);
  });
});
