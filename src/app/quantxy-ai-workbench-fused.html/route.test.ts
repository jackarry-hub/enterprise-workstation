import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { createWorkstationHtmlResponse } from "./route-support";

describe("formal workstation html route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("serves the fused workstation preview only from a local host", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WORKSTATION_DEMO_ENABLED", "true");
    const response = await GET(
      new Request("http://127.0.0.1/quantxy-ai-workbench-fused.html?v=preview"),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html.length).toBeGreaterThan(100_000);
    expect(html).toContain("量子星河 QuantXY · AI 企业工作台");
    expect(html).toContain("workstation-server-adapter.js?v=server-embed-c4-drafts-domains");
    expect(html).not.toContain("/_next/static/chunks/app/not-found");
    expect(html).not.toContain("/_next/static/chunks/app/login");
  });

  it("rejects a localhost fused preview in production even if demo or public flags are set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKSTATION_DEMO_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_WORKSTATION_ALLOW_MOCK_DATA", "true");

    const response = await GET(
      new Request("http://localhost:3030/quantxy-ai-workbench-fused.html?v=preview"),
    );

    expect(response.status).toBe(404);
  });

  it("rejects a non-local fused preview even when the route handler is called directly", async () => {
    const response = await GET(
      new Request("https://work.quantumgalaxy.top/quantxy-ai-workbench-fused.html?v=preview"),
    );

    expect(response.status).toBe(404);
  });

  it("rejects the retired formal fused entry before loading a bootstrap", async () => {
    const response = await createWorkstationHtmlResponse(
      new Request("https://work.quantumgalaxy.top/quantxy-ai-workbench-fused.html?formal=1"),
    );
    expect(response.status).toBe(404);
  });

  it("rejects formal fused requests without invoking the legacy login path", async () => {
    const response = await createWorkstationHtmlResponse(
      new Request("https://work.quantumgalaxy.top/quantxy-ai-workbench-fused.html?formal=1&v=live"),
    );

    expect(response.status).toBe(404);
  });
});
