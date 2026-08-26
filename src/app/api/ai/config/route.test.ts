import { afterEach, describe, expect, it, vi } from "vitest";

import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseServiceRoleClient: vi.fn(),
  getWorkspaceApiSession: vi.fn(),
  getAiConfigEnv: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  getSupabaseServiceRoleClient: mocks.getSupabaseServiceRoleClient,
}));
vi.mock("@/features/ai-config/workspace-api-session", () => ({
  getWorkspaceApiSession: mocks.getWorkspaceApiSession,
}));
vi.mock("@/features/ai-config/ai-config-env", () => ({ getAiConfigEnv: mocks.getAiConfigEnv }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { PUT } from "@/app/api/ai/config/route";

const aiAdminSession = {
  ...executiveWorkspaceSession,
  permissionCodes: [
    ...executiveWorkspaceSession.permissionCodes,
    "ai.config.manage" as const,
  ],
};

describe("PUT /api/ai/config", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("executes the audited mutation RPC with the authenticated request client, never a service-role client", async () => {
    const authenticatedClient = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          provider: "deepseek",
          api_base_url: "https://api.deepseek.com",
          model_name: "deepseek-chat",
          key_configured: false,
          key_hint: null,
          updated_at: "2026-08-26T12:00:00.000Z",
        },
        error: null,
      }),
    };
    const serviceClient = { rpc: vi.fn() };
    mocks.getSupabaseServerClient.mockResolvedValue(authenticatedClient);
    mocks.getSupabaseServiceRoleClient.mockReturnValue(serviceClient);
    mocks.getWorkspaceApiSession.mockResolvedValue(aiAdminSession);
    mocks.getAiConfigEnv.mockReturnValue({
      encryptionKey: new Uint8Array(32).fill(1),
      supabaseServiceRoleKey: "must-not-be-used-for-put",
    });
    mocks.createClient.mockReturnValue(serviceClient);

    const request = new Request("https://workspace.test/api/ai/config", {
      method: "PUT",
      headers: { "Idempotency-Key": "30000000-0000-4000-8000-000000000003" },
      body: JSON.stringify({ model: "deepseek-chat" }),
    });
    const response = await PUT(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: "deepseek",
      apiBaseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      keyConfigured: false,
      keyHint: null,
      updatedAt: "2026-08-26T12:00:00.000Z",
      canManage: true,
    });
    expect(mocks.getWorkspaceApiSession).toHaveBeenCalledWith(request, authenticatedClient);
    expect(authenticatedClient.rpc).toHaveBeenCalledWith(
      "update_current_ai_provider_config",
      expect.objectContaining({
        provider: "deepseek",
        model: "deepseek-chat",
        encrypted_key: null,
        key_hint: null,
        request_id: expect.any(String),
      }),
    );
    expect(serviceClient.rpc).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns a safe 403 when database authorization is revoked after the session was loaded", async () => {
    const authenticatedClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "42501",
          message: "permission was revoked after session creation",
          details: "sensitive database detail",
        },
      }),
    };
    mocks.getSupabaseServerClient.mockResolvedValue(authenticatedClient);
    mocks.getWorkspaceApiSession.mockResolvedValue(aiAdminSession);
    mocks.getAiConfigEnv.mockReturnValue({
      encryptionKey: new Uint8Array(32).fill(1),
      supabaseServiceRoleKey: "must-not-be-used-for-put",
    });

    const response = await PUT(new Request("https://workspace.test/api/ai/config", {
      method: "PUT",
      headers: { "Idempotency-Key": "30000000-0000-4000-8000-000000000004" },
      body: JSON.stringify({ model: "deepseek-chat" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "forbidden" });
    expect(JSON.stringify(body)).not.toContain("permission was revoked");
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });
});
