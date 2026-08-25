import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("formal workstation html route", () => {
  it("serves the fused workstation html instead of the Next login/not-found shell", async () => {
    const response = await GET();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html.length).toBeGreaterThan(100_000);
    expect(html).toContain("量子星河 QuantXY · AI 企业工作台");
    expect(html).toContain("workstation-server-adapter.js");
    expect(html).not.toContain("/_next/static/chunks/app/not-found");
    expect(html).not.toContain("/_next/static/chunks/app/login");
  });
});
