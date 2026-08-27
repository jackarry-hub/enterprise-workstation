import { describe, expect, it, vi } from "vitest";

import { loadActiveWorkspaceScope } from "@/features/projects/data/active-workspace-data";
import type { ProjectCollectionClientFactory } from "@/features/projects/data/project-collection-data";

type QueryResponse = { data: unknown; error: Error | null };

function createClient(providerStatus = "active") {
  const filters: Array<[string, string, unknown]> = [];
  const responses: Record<string, QueryResponse> = {
    external_identities: { data: { tenant_id: 7, organization_id: 11, organization_member_id: 19, identity_provider_id: 23 }, error: null },
    tenants: { data: { status: "active" }, error: null },
    identity_providers: { data: { status: providerStatus }, error: null },
    organizations: { data: { public_id: "a1000000-0000-4000-8000-000000000001" }, error: null },
    organization_members: { data: { public_id: "a1000000-0000-4000-8000-000000000002", user_id: "user-1", status: "active" }, error: null },
    employee_profiles: { data: { public_id: "a1000000-0000-4000-8000-000000000003", employment_status: "active" }, error: null },
  };
  const from = vi.fn((table: string) => {
    const response = responses[table];
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => {
        filters.push([table, field, value]);
        return query;
      },
      is: (field: string, value: unknown) => {
        filters.push([table, field, value]);
        return query;
      },
      maybeSingle: async () => response,
    };
    return query;
  });
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from,
  } as unknown as Awaited<ReturnType<ProjectCollectionClientFactory>>;
  return { client, filters };
}

describe("loadActiveWorkspaceScope", () => {
  it("derives one exact tenant, organization, and member scope from the active external identity", async () => {
    const { client, filters } = createClient();

    await expect(loadActiveWorkspaceScope(client)).resolves.toEqual({
      authUserId: "user-1",
      tenantId: 7,
      organizationId: 11,
      organizationPublicId: "a1000000-0000-4000-8000-000000000001",
      memberId: 19,
      memberPublicId: "a1000000-0000-4000-8000-000000000002",
      employeePublicId: "a1000000-0000-4000-8000-000000000003",
    });
    expect(filters).toEqual(expect.arrayContaining([
      ["external_identities", "auth_user_id", "user-1"],
      ["external_identities", "status", "active"],
      ["organizations", "tenant_id", 7],
      ["organizations", "id", 11],
      ["organization_members", "organization_id", 11],
      ["organization_members", "id", 19],
      ["employee_profiles", "organization_member_id", 19],
    ]));
  });

  it("fails closed when the selected identity provider is inactive", async () => {
    const { client } = createClient("disabled");
    await expect(loadActiveWorkspaceScope(client)).rejects.toThrow("active_workspace_scope_invalid");
  });
});
