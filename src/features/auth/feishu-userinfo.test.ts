import { describe, expect, it, vi } from "vitest";
import {
  handleFeishuUserInfo,
  normalizeFeishuUserInfo,
} from "@/features/auth/feishu-userinfo";

const feishuBody = {
  code: 0,
  data: {
    open_id: "ou_qxy_001",
    union_id: "on_qxy_001",
    tenant_key: "tenant_qxy",
    name: "量子员工",
    avatar_url: "https://example.com/avatar.png",
  },
};

describe("Feishu UserInfo adapter", () => {
  it("maps the Feishu envelope to an OAuth-compatible root object", () => {
    expect(normalizeFeishuUserInfo(feishuBody, "tenant_qxy")).toEqual({
      sub: "ou_qxy_001",
      name: "量子员工",
      picture: "https://example.com/avatar.png",
      open_id: "ou_qxy_001",
      union_id: "on_qxy_001",
      tenant_key: "tenant_qxy",
    });
  });

  it("rejects another Feishu tenant without reflecting the token", async () => {
    const request = new Request(
      "https://brain.quantxy.com/api/auth/feishu/userinfo",
      { headers: { Authorization: "Bearer sensitive-user-token" } },
    );
    const response = await handleFeishuUserInfo(request, {
      tenantKey: "tenant_qxy",
      fetchImpl: vi.fn(async () =>
        Response.json({
          ...feishuBody,
          data: { ...feishuBody.data, tenant_key: "tenant_other" },
        }),
      ),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("sensitive-user-token");
  });

  it("treats a missing tenant key as a failed upstream response", async () => {
    const response = await handleFeishuUserInfo(
      new Request("https://brain.quantxy.com/api/auth/feishu/userinfo", {
        headers: { Authorization: "Bearer test-token" },
      }),
      {
        tenantKey: "tenant_qxy",
        fetchImpl: vi.fn(async () =>
          Response.json({
            code: 0,
            data: {
              open_id: "ou_qxy_001",
              union_id: "on_qxy_001",
              name: "量子员工",
              avatar_url: "https://example.com/avatar.png",
            },
          }),
        ),
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_failed" });
  });

  it.each(["", "   "])(
    "treats a %j tenant key as a failed upstream response",
    async (upstreamTenantKey) => {
      const response = await handleFeishuUserInfo(
        new Request("https://brain.quantxy.com/api/auth/feishu/userinfo", {
          headers: { Authorization: "Bearer test-token" },
        }),
        {
          tenantKey: "tenant_qxy",
          fetchImpl: vi.fn(async () =>
            Response.json({
              ...feishuBody,
              data: {
                ...feishuBody.data,
                tenant_key: upstreamTenantKey,
              },
            }),
          ),
        },
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "upstream_failed" });
    },
  );

  it("rejects a missing bearer token before calling Feishu", async () => {
    const fetchImpl = vi.fn();
    const response = await handleFeishuUserInfo(
      new Request("https://brain.quantxy.com/api/auth/feishu/userinfo"),
      { tenantKey: "tenant_qxy", fetchImpl },
    );

    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only bearer token before calling Feishu", async () => {
    const fetchImpl = vi.fn();
    const response = await handleFeishuUserInfo(
      new Request("https://brain.quantxy.com/api/auth/feishu/userinfo", {
        headers: { Authorization: "Bearer \u00a0" },
      }),
      { tenantKey: "tenant_qxy", fetchImpl },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps an upstream 401 to a stable invalid credential response", async () => {
    const response = await handleFeishuUserInfo(
      new Request("https://brain.quantxy.com/api/auth/feishu/userinfo", {
        headers: { Authorization: "Bearer sensitive-user-token" },
      }),
      {
        tenantKey: "tenant_qxy",
        fetchImpl: vi.fn(async () =>
          Response.json(
            { message: "sensitive-user-token is invalid" },
            { status: 401 },
          ),
        ),
      },
    );

    expect(response.status).toBe(401);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "invalid_request" });
    expect(body).not.toContain("sensitive-user-token");
  });

  it("returns a stable gateway error for a failed Feishu request", async () => {
    const response = await handleFeishuUserInfo(
      new Request("https://brain.quantxy.com/api/auth/feishu/userinfo", {
        headers: { Authorization: "Bearer test-token" },
      }),
      {
        tenantKey: "tenant_qxy",
        fetchImpl: vi.fn(
          async () => new Response("unavailable", { status: 503 }),
        ),
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_failed" });
  });
});
