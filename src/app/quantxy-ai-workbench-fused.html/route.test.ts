import { describe, expect, it } from "vitest";

import { GET } from "./route";
import { createWorkstationHtmlResponse } from "./route-support";

describe("formal workstation html route", () => {
  it("serves the fused workstation html instead of the Next login/not-found shell", async () => {
    const response = await GET(
      new Request("https://work.quantumgalaxy.top/quantxy-ai-workbench-fused.html?v=preview"),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html.length).toBeGreaterThan(100_000);
    expect(html).toContain("量子星河 QuantXY · AI 企业工作台");
    expect(html).toContain("workstation-server-adapter.js");
    expect(html).not.toContain("/_next/static/chunks/app/not-found");
    expect(html).not.toContain("/_next/static/chunks/app/login");
  });

  it("embeds the authenticated formal bootstrap before loading the browser adapter", async () => {
    const response = await createWorkstationHtmlResponse(
      new Request("https://work.quantumgalaxy.top/quantxy-ai-workbench-fused.html?formal=1"),
      {
        loadSession: async () => ({ member: { id: 7 } }),
        loadBootstrap: async () => ({
          session: {
            authenticated: true,
            authMode: "feishu",
            dataMode: "server",
            memberId: 7,
            permissions: ["task.manage"],
          },
          members: [{ id: 7, n: "董佳瑶", r: "CEO", lv: 6 }],
          projects: [],
          tasks: [],
          payroll: { 7: [] },
          features: { identitySwitch: false, demoReset: false },
        }),
      },
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('id="qxy-server-bootstrap"');
    expect(html).toContain("window.__QUANTXY_SERVER_BOOTSTRAP__=");
    expect(html).toContain('"memberId":7');
    expect(html.indexOf("window.__QUANTXY_SERVER_BOOTSTRAP__="))
      .toBeLessThan(html.indexOf("workstation-server-adapter.js"));
  });

  it("redirects unauthenticated formal requests back to login with a safe return path", async () => {
    const response = await createWorkstationHtmlResponse(
      new Request("https://work.quantumgalaxy.top/quantxy-ai-workbench-fused.html?formal=1&v=live"),
      {
        loadSession: async () => null,
        loadBootstrap: async () => {
          throw new Error("should_not_load_bootstrap_without_session");
        },
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://work.quantumgalaxy.top/login?next=%2Fquantxy-ai-workbench-fused.html%3Fformal%3D1%26v%3Dlive",
    );
  });
});
