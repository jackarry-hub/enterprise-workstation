import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { getWorkspaceApiSession } from "@/features/ai-config/workspace-api-session";
import type { DemoAuthEnv } from "@/features/demo-auth/demo-auth-env";
import { createDemoSessionToken, DEMO_SESSION_COOKIE } from "@/features/demo-auth/demo-session";

const access = {
  tenantId: "10000000-0000-4000-8000-000000000000",
  authUserId: "10000000-0000-4000-8000-000000000001",
  providerCode: "feishu",
  authProvider: "custom:feishu",
  providerSubject: "subject-executive-001",
  organizationId: "10000000-0000-4000-8000-000000000002",
  organizationName: "量子星河",
  memberId: 10,
  memberStatus: "active",
  employeeProfileId: "10000000-0000-4000-8000-000000000003",
  employmentStatus: "active",
  displayName: "真实决策人",
  avatarUrl: null,
  departmentName: "总经办",
  jobTitle: "董事长",
  skills: ["strategy"],
  roleCodes: ["owner"],
  customRoleCodes: [],
  permissionCodes: ["dashboard.read"],
};

describe("getWorkspaceApiSession", () => {
  it("returns null when the request has no authenticated user", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      rpc: async () => ({ data: null, error: null }),
    } as unknown as SupabaseClient;

    await expect(getWorkspaceApiSession(undefined, client)).resolves.toBeNull();
  });

  it("returns the parsed current-tenant workspace session", async () => {
    const client = {
      auth: {
        getUser: async () => ({
          data: { user: { id: access.authUserId } },
          error: null,
        }),
      },
      rpc: async () => ({ data: access, error: null }),
    } as unknown as SupabaseClient;

    const session = await getWorkspaceApiSession(undefined, client);

    expect(session?.tenantId).toBe(access.tenantId);
    expect(session?.authUserId).toBe(access.authUserId);
    expect(session?.primaryRole).toBe("executive");
  });

  it("accepts a signed demo cookie before consulting Supabase", async () => {
    const env: DemoAuthEnv = {
      username: "admin",
      password: "correct-horse-battery",
      tenantId: access.tenantId,
      signingKey: new Uint8Array(32).fill(4),
    };
    const token = await createDemoSessionToken(env, false);
    const request = new Request("https://workspace.test/api/ai/config", {
      headers: { cookie: `${DEMO_SESSION_COOKIE}=${token}` },
    });
    const client = {
      auth: { getUser: async () => { throw new Error("Supabase should not run"); } },
      rpc: async () => { throw new Error("Supabase should not run"); },
    } as unknown as SupabaseClient;

    const session = await getWorkspaceApiSession(request, client, env);

    expect(session?.tenantId).toBe(access.tenantId);
    expect(session?.primaryRole).toBe("executive");
    expect(session?.isAdmin).toBe(true);
  });
});
