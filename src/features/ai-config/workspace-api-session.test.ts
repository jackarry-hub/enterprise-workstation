import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { getWorkspaceApiSession } from "@/features/ai-config/workspace-api-session";

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
  permissionCodes: ["dashboard.read"],
};

describe("getWorkspaceApiSession", () => {
  it("returns null when the request has no authenticated user", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      rpc: async () => ({ data: null, error: null }),
    } as unknown as SupabaseClient;

    await expect(getWorkspaceApiSession(client)).resolves.toBeNull();
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

    const session = await getWorkspaceApiSession(client);

    expect(session?.tenantId).toBe(access.tenantId);
    expect(session?.authUserId).toBe(access.authUserId);
    expect(session?.primaryRole).toBe("executive");
  });
});
