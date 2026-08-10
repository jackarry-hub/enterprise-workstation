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
      sub: "open_id:ou_qxy_001",
      provider_subject: "open_id:ou_qxy_001",
      provider_tenant_key: "tenant_qxy",
      provider_match_keys: [
        "open_id:ou_qxy_001",
        "union_id:on_qxy_001",
      ],
      name: "量子员工",
      picture: "https://example.com/avatar.png",
      open_id: "ou_qxy_001",
      union_id: "on_qxy_001",
      tenant_key: "tenant_qxy",
    });
  });

  it("produces generic claim fields from an open-ID-only identity", () => {
    expect(
      normalizeFeishuUserInfo(
        {
          code: 0,
          data: {
            open_id: " OU_ONLY ",
            tenant_key: "tenant_qxy",
            name: "Open ID 员工",
          },
        },
        "tenant_qxy",
      ),
    ).toMatchObject({
      sub: "open_id:ou_only",
      provider_subject: "open_id:ou_only",
      provider_match_keys: ["open_id:ou_only"],
      provider_tenant_key: "tenant_qxy",
    });
  });

  it("produces generic claim fields from a union-ID-only identity", () => {
    expect(
      normalizeFeishuUserInfo(
        {
          code: 0,
          data: {
            union_id: " ON_ONLY ",
            tenant_key: "tenant_qxy",
            name: "Union ID 员工",
          },
        },
        "tenant_qxy",
      ),
    ).toMatchObject({
      sub: "union_id:on_only",
      provider_subject: "union_id:on_only",
      provider_match_keys: ["union_id:on_only"],
      provider_tenant_key: "tenant_qxy",
    });
  });

  it("produces verified generic claim fields from a trustworthy email-only identity", () => {
    expect(
      normalizeFeishuUserInfo(
        {
          code: 0,
          data: {
            email: " Employee@QuantXY.Example ",
            tenant_key: "tenant_qxy",
            name: "邮箱员工",
          },
        },
        "tenant_qxy",
      ),
    ).toMatchObject({
      sub: "email:employee@quantxy.example",
      provider_subject: "email:employee@quantxy.example",
      provider_match_keys: ["email:employee@quantxy.example"],
      provider_tenant_key: "tenant_qxy",
      verified_email: "employee@quantxy.example",
      email: "employee@quantxy.example",
    });
  });

  it("does not promote malformed or explicitly unverified email claims", () => {
    const malformed = normalizeFeishuUserInfo(
      {
        code: 0,
        data: {
          open_id: "ou_safe",
          email: "not-an-email",
          tenant_key: "tenant_qxy",
          name: "安全员工",
        },
      },
      "tenant_qxy",
    );
    const unverified = normalizeFeishuUserInfo(
      {
        code: 0,
        data: {
          open_id: "ou_safe",
          email: "unverified@quantxy.example",
          email_verified: false,
          tenant_key: "tenant_qxy",
          name: "安全员工",
        },
      },
      "tenant_qxy",
    );

    expect(malformed).not.toHaveProperty("verified_email");
    expect(malformed).not.toHaveProperty("email");
    expect(malformed.provider_match_keys).toEqual(["open_id:ou_safe"]);
    expect(unverified).not.toHaveProperty("verified_email");
    expect(unverified).not.toHaveProperty("email");
    expect(unverified.provider_match_keys).toEqual(["open_id:ou_safe"]);
  });

  it("rejects malformed or unverified email when it is the only identity", () => {
    expect(() =>
      normalizeFeishuUserInfo(
        {
          code: 0,
          data: {
            email: "not-an-email",
            tenant_key: "tenant_qxy",
            name: "异常员工",
          },
        },
        "tenant_qxy",
      ),
    ).toThrow("invalid_feishu_identity");
    expect(() =>
      normalizeFeishuUserInfo(
        {
          code: 0,
          data: {
            email: "unverified@quantxy.example",
            email_verified: false,
            tenant_key: "tenant_qxy",
            name: "异常员工",
          },
        },
        "tenant_qxy",
      ),
    ).toThrow("invalid_feishu_identity");
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

  it("rejects a bearer token with embedded whitespace before calling Feishu", async () => {
    const fetchImpl = vi.fn();
    const response = await handleFeishuUserInfo(
      new Request("https://brain.quantxy.com/api/auth/feishu/userinfo", {
        headers: { Authorization: "Bearer token extra" },
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
