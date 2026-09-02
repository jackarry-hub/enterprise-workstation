import { describe, expect, it, vi } from "vitest";

import { handleEnterpriseInitialization } from "@/features/settings/enterprise-initialization-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("enterprise initialization", () => {
  it("loads the authoritative initialization state", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "ready", departmentCount: 5, positionCount: 12, skillCount: 20 },
      error: null,
    });
    const response = await handleEnterpriseInitialization(
      new Request("https://q.test/api/workstation/enterprise-initialization"),
      { loadSession: async () => executiveWorkspaceSession, rpc },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ready", canInitialize: true });
    expect(rpc).toHaveBeenCalledWith("current_tenant_initialization", {});
  });

  it("initializes a fresh company through the owner-only database function", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "ready", departmentCount: 5, positionCount: 12, skillCount: 20 },
      error: null,
    });
    const response = await handleEnterpriseInitialization(
      new Request("https://q.test/api/workstation/enterprise-initialization", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName: "赛博老爸",
          shortName: "赛博老爸",
          industry: "人工智能",
          description: "企业 AI 服务",
          timezone: "Asia/Shanghai",
        }),
      }),
      { loadSession: async () => executiveWorkspaceSession, rpc },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("activate_current_enterprise", {
      p_company_name: "赛博老爸",
      p_short_name: "赛博老爸",
      p_industry: "人工智能",
      p_description: "企业 AI 服务",
      p_timezone: "Asia/Shanghai",
      p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("rejects non-owners before database mutation", async () => {
    const rpc = vi.fn();
    const response = await handleEnterpriseInitialization(
      new Request("https://q.test/api/workstation/enterprise-initialization", {
        method: "POST",
        body: JSON.stringify({ companyName: "公司", shortName: "公司", industry: "科技", description: "", timezone: "Asia/Shanghai" }),
      }),
      { loadSession: async () => ({ ...executiveWorkspaceSession, roleCodes: ["admin"] }), rpc },
    );

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid company fields before database mutation", async () => {
    const rpc = vi.fn();
    const response = await handleEnterpriseInitialization(
      new Request("https://q.test/api/workstation/enterprise-initialization", {
        method: "POST",
        body: JSON.stringify({ companyName: "", shortName: "公司", industry: "科技", description: "", timezone: "Asia/Shanghai" }),
      }),
      { loadSession: async () => executiveWorkspaceSession, rpc },
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
