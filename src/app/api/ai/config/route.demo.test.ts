import { afterEach, describe, expect, it, vi } from "vitest";

import { createDemoSessionToken, DEMO_SESSION_COOKIE } from "@/features/demo-auth/demo-session";
import { getDemoAuthEnv } from "@/features/demo-auth/demo-auth-env";

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  getSupabaseServiceRoleClient: mocks.getSupabaseServiceRoleClient,
}));

import { GET, PUT } from "@/app/api/ai/config/route";

const tenantId = "50000000-0000-4000-8000-000000000001";

function enableSignedDemo() {
  vi.stubEnv("WORKSTATION_DEMO_ENABLED", "true");
  vi.stubEnv("WORKSTATION_DEMO_PASSWORD", "correct-horse-battery");
  vi.stubEnv("WORKSTATION_DEMO_TENANT_ID", tenantId);
  vi.stubEnv("AI_CONFIG_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
}

async function signedDemoRequest(method: "GET" | "PUT") {
  const token = await createDemoSessionToken(getDemoAuthEnv(), false);
  return new Request("https://workspace.test/api/ai/config", {
    method,
    headers: {
      cookie: `${DEMO_SESSION_COOKIE}=${token}`,
      ...(method === "PUT"
        ? {
          "content-type": "application/json",
          "Idempotency-Key": "50000000-0000-4000-8000-000000000002",
        }
        : {}),
    },
    ...(method === "PUT" ? { body: JSON.stringify({ model: "deepseek-chat" }) } : {}),
  });
}

describe("AI configuration demo sessions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("reads a signed demo cookie through the request and returns only strict safe metadata", async () => {
    enableSignedDemo();
    const authenticatedClient = {
      auth: { getUser: vi.fn(() => { throw new Error("demo must not use database auth"); }) },
      rpc: vi.fn(() => { throw new Error("demo must not use authenticated RPC"); }),
    };
    mocks.getSupabaseServerClient.mockResolvedValue(authenticatedClient);

    const response = await (GET as (request: Request) => Promise<Response>)(
      await signedDemoRequest("GET"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      canManage: false,
      keyHint: null,
      keyConfigured: false,
      model: "deepseek-v4-flash",
    });
    expect(authenticatedClient.auth.getUser).not.toHaveBeenCalled();
    expect(authenticatedClient.rpc).not.toHaveBeenCalled();
    expect(mocks.getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects a signed demo cookie PUT without any authenticated or service mutation", async () => {
    enableSignedDemo();
    const authenticatedClient = {
      auth: { getUser: vi.fn(() => { throw new Error("demo must not use database auth"); }) },
      rpc: vi.fn(() => { throw new Error("demo must not use authenticated RPC"); }),
    };
    mocks.getSupabaseServerClient.mockResolvedValue(authenticatedClient);

    const response = await PUT(await signedDemoRequest("PUT"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(authenticatedClient.auth.getUser).not.toHaveBeenCalled();
    expect(authenticatedClient.rpc).not.toHaveBeenCalled();
    expect(mocks.getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });
});
