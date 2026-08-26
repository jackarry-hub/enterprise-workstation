import { describe, expect, it } from "vitest";

import {
  AgentInvocationAuthorizationError,
  authorizeAgentInvocation,
} from "@/features/agents/authorize-agent-invocation";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const agentPublicId = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;

function authorizationClient(overrides: Partial<Record<string, Row[]>> = {}) {
  const rows: Record<string, Row[]> = {
    tenants: [{ id: 2, public_id: executiveWorkspaceSession.tenantId, status: "active" }],
    organizations: [{ id: 3, tenant_id: 2, public_id: executiveWorkspaceSession.organization.id }],
    organization_members: [{
      id: executiveWorkspaceSession.member.id,
      tenant_id: 2,
      organization_id: 3,
      user_id: executiveWorkspaceSession.authUserId,
      status: "active",
    }],
    employee_profiles: [{
      id: 91,
      tenant_id: 2,
      organization_id: 3,
      organization_member_id: executiveWorkspaceSession.member.id,
      department_id: 44,
      job_level: 20,
      employment_status: "active",
      deleted_at: null,
    }],
    departments: [{ id: 44, tenant_id: 2, organization_id: 3, deleted_at: null }],
    member_roles: [{ role_id: 7, tenant_id: 2, member_id: executiveWorkspaceSession.member.id }],
    roles: [{ id: 7, tenant_id: 2, organization_id: 3, code: "employee", is_enabled: true }],
    agent_definitions: [{
      id: 81,
      tenant_id: 2,
      organization_id: 3,
      public_id: agentPublicId,
      status: "enabled",
      deleted_at: null,
      department_id: null,
      min_job_level: 20,
      prompt_version: "v20",
      system_prompt: "Only the database prompt may be used.",
      model_code: "deepseek-chat",
      tool_scope: { tools: ["task.read", "knowledge.search"] },
    }],
    agent_permissions: [{
      id: 1,
      tenant_id: 2,
      organization_id: 3,
      agent_id: 81,
      scope_type: "role",
      role_code: "employee",
      department_id: null,
      member_id: null,
      min_job_level: 20,
      deleted_at: null,
    }],
    ...overrides,
  };
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  return {
    calls,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        in: (column: string, value: unknown[]) => {
          filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => {
          calls.push({ table, filters });
          const data = rows[table] ?? [];
          return { data: data[0] ?? null, error: null };
        },
        then: <T>(resolve: (value: { data: Row[]; error: null }) => T) => {
          calls.push({ table, filters });
          return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

describe("authorizeAgentInvocation", () => {
  it("authorizes only a DB-scoped active member and returns DB-owned execution data", async () => {
    const client = authorizationClient();

    await expect(authorizeAgentInvocation(client, executiveWorkspaceSession, agentPublicId))
      .resolves.toEqual({
        definitionId: 81,
        tenantId: 2,
        organizationId: 3,
        version: "v20",
        systemPrompt: "Only the database prompt may be used.",
        model: "deepseek-chat",
        toolCodes: ["task.read", "knowledge.search"],
      });

    expect(client.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "organizations", filters: expect.arrayContaining([
        ["tenant_id", 2],
        ["public_id", executiveWorkspaceSession.organization.id],
      ]) }),
      expect.objectContaining({ table: "agent_definitions", filters: expect.arrayContaining([
        ["tenant_id", 2],
        ["organization_id", 3],
        ["public_id", agentPublicId],
        ["status", "enabled"],
      ]) }),
    ]));
  });

  it("hides a cross-organization leaked Agent UUID as not found", async () => {
    const client = authorizationClient({ agent_definitions: [] });

    await expect(authorizeAgentInvocation(client, executiveWorkspaceSession, agentPublicId))
      .rejects.toMatchObject({ code: "agent_not_found" } satisfies Partial<AgentInvocationAuthorizationError>);
  });

  it("rejects stale sessions and nonmatching per-Agent rules", async () => {
    const stale = authorizationClient({ organization_members: [{
      id: executiveWorkspaceSession.member.id,
      tenant_id: 2,
      organization_id: 3,
      user_id: "90000000-0000-4000-8000-000000000001",
      status: "active",
    }] });
    await expect(authorizeAgentInvocation(stale, executiveWorkspaceSession, agentPublicId))
      .rejects.toMatchObject({ code: "agent_forbidden" });

    const noRule = authorizationClient({ agent_permissions: [] });
    await expect(authorizeAgentInvocation(noRule, executiveWorkspaceSession, agentPublicId))
      .rejects.toMatchObject({ code: "agent_forbidden" });

    const wrongDepartment = authorizationClient({ agent_permissions: [{
      id: 2, tenant_id: 2, organization_id: 3, agent_id: 81, scope_type: "dept",
      department_id: 99, role_code: null, member_id: null, min_job_level: 20, deleted_at: null,
    }] });
    await expect(authorizeAgentInvocation(wrongDepartment, executiveWorkspaceSession, agentPublicId))
      .rejects.toMatchObject({ code: "agent_forbidden" });
  });

  it("honors a DB member rule without treating management session permissions as an override", async () => {
    const client = authorizationClient({ agent_permissions: [{
      id: 3, tenant_id: 2, organization_id: 3, agent_id: 81, scope_type: "member",
      department_id: null, role_code: null, member_id: executiveWorkspaceSession.member.id,
      min_job_level: 20, deleted_at: null,
    }] });
    const managementSession = {
      ...executiveWorkspaceSession,
      permissionCodes: ["agent.manage", "agent.orchestrate"] as typeof executiveWorkspaceSession.permissionCodes,
    };

    await expect(authorizeAgentInvocation(client, managementSession, agentPublicId)).resolves
      .toMatchObject({ definitionId: 81, version: "v20" });
  });

  it("fails closed for malformed Agent prompt, model, or tool scope", async () => {
    const client = authorizationClient({ agent_definitions: [{
      id: 81, tenant_id: 2, organization_id: 3, public_id: agentPublicId,
      status: "enabled", deleted_at: null, min_job_level: 1, prompt_version: "v1",
      system_prompt: "", model_code: "browser-model", tool_scope: { tools: "unsafe" },
    }] });

    await expect(authorizeAgentInvocation(client, executiveWorkspaceSession, agentPublicId))
      .rejects.toMatchObject({ code: "agent_forbidden" });
  });
});
