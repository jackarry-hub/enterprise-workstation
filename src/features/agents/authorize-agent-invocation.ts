import { type AiModel } from "@/features/ai-config/ai-config-types";
import {
  evaluateAgentInvocationAccess,
  parseAgentExecutionConfig,
  type AgentInvocationRule,
} from "@/features/agents/agent-invocation-policy";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

type QueryResult<T> = PromiseLike<{ data: T | null; error: unknown }>;

type QueryBuilder<T> = {
  select: (columns: string) => QueryBuilder<T>;
  eq: (column: string, value: unknown) => QueryBuilder<T>;
  is: (column: string, value: unknown) => QueryBuilder<T>;
  in: (column: string, values: readonly unknown[]) => QueryBuilder<T>;
  maybeSingle: () => QueryResult<T>;
} & PromiseLike<{ data: T[] | null; error: unknown }>;

export type AgentAuthorizationClient = {
  from: <T extends Record<string, unknown>>(table: string) => QueryBuilder<T>;
};

export type AuthorizedAgent = {
  definitionId: number;
  versionDefinitionId: number;
  tenantId: number;
  organizationId: number;
  version: string;
  systemPrompt: string;
  model: AiModel;
  toolCodes: string[];
};

export class AgentInvocationAuthorizationError extends Error {
  constructor(public readonly code: "agent_not_found" | "agent_forbidden") {
    super(code);
  }
}

type ScopedRow = Record<string, unknown>;

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function nonEmptyText(value: unknown, max = 12_000): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max;
}

function forbidden(): never {
  throw new AgentInvocationAuthorizationError("agent_forbidden");
}

function notFound(): never {
  throw new AgentInvocationAuthorizationError("agent_not_found");
}

async function maybeSingle<T extends Record<string, unknown>>(
  query: QueryResult<T>,
  onMissing: () => never,
): Promise<T> {
  const { data, error } = await query;
  if (error || !data) return onMissing();
  return data;
}

async function rows<T extends Record<string, unknown>>(
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) forbidden();
  return data ?? [];
}

/**
 * Resolves an invocation against server-owned tenant, member, Agent and role facts.
 * The session supplies public identity hints only; every numeric write scope below is DB-derived.
 */
export async function authorizeAgentInvocation(
  rawClient: unknown,
  session: WorkspaceSession,
  agentPublicId: string,
): Promise<AuthorizedAgent> {
  const client = rawClient as AgentAuthorizationClient;
  const tenant = await maybeSingle(
    client.from<ScopedRow>("tenants").select("id, public_id, status")
      .eq("public_id", session.tenantId).maybeSingle(),
    forbidden,
  );
  const tenantId = positiveInteger(tenant.id);
  if (!tenantId || tenant.status !== "active") forbidden();

  const organization = await maybeSingle(
    client.from<ScopedRow>("organizations").select("id, tenant_id, public_id")
      .eq("tenant_id", tenantId).eq("public_id", session.organization.id).maybeSingle(),
    forbidden,
  );
  const organizationId = positiveInteger(organization.id);
  if (!organizationId || positiveInteger(organization.tenant_id) !== tenantId) forbidden();

  const member = await maybeSingle(
    client.from<ScopedRow>("organization_members")
      .select("id, tenant_id, organization_id, user_id, status")
      .eq("tenant_id", tenantId).eq("organization_id", organizationId)
      .eq("id", session.member.id).eq("user_id", session.authUserId).eq("status", "active")
      .maybeSingle(),
    forbidden,
  );
  const memberId = positiveInteger(member.id);
  if (!memberId || positiveInteger(member.tenant_id) !== tenantId
    || positiveInteger(member.organization_id) !== organizationId
    || member.user_id !== session.authUserId || member.status !== "active") forbidden();

  const profile = await maybeSingle(
    client.from<ScopedRow>("employee_profiles")
      .select("id, tenant_id, organization_id, organization_member_id, department_id, job_level, employment_status, deleted_at")
      .eq("tenant_id", tenantId).eq("organization_id", organizationId)
      .eq("organization_member_id", memberId).is("deleted_at", null)
      .maybeSingle(),
    forbidden,
  );
  const jobLevel = positiveInteger(profile.job_level);
  const departmentId = positiveInteger(profile.department_id);
  if (positiveInteger(profile.tenant_id) !== tenantId
    || positiveInteger(profile.organization_id) !== organizationId
    || positiveInteger(profile.organization_member_id) !== memberId
    || !departmentId || !jobLevel || jobLevel > 20
    || !["probation", "active", "on_leave"].includes(String(profile.employment_status))) forbidden();

  const department = await maybeSingle(
    client.from<ScopedRow>("departments").select("id, tenant_id, organization_id, deleted_at")
      .eq("tenant_id", tenantId).eq("organization_id", organizationId).eq("id", departmentId)
      .is("deleted_at", null).maybeSingle(),
    forbidden,
  );
  if (positiveInteger(department.id) !== departmentId || positiveInteger(department.tenant_id) !== tenantId
    || positiveInteger(department.organization_id) !== organizationId || department.deleted_at !== null) forbidden();

  const assignments = await rows(
    client.from<ScopedRow>("member_roles").select("role_id, tenant_id, member_id")
      .eq("tenant_id", tenantId).eq("member_id", memberId),
  );
  const roleIds = assignments.flatMap((assignment) => (
    positiveInteger(assignment.tenant_id) === tenantId && positiveInteger(assignment.member_id) === memberId
      ? [positiveInteger(assignment.role_id)].filter((id): id is number => id !== null)
      : []
  ));
  const roleRows = roleIds.length
    ? await rows(client.from<ScopedRow>("roles").select("id, tenant_id, organization_id, code, is_enabled")
      .eq("tenant_id", tenantId).in("id", roleIds))
    : [];
  const roleCodes = new Set(roleRows.flatMap((role) => {
    const roleId = positiveInteger(role.id);
    const organizationMatches = role.organization_id === null
      || positiveInteger(role.organization_id) === organizationId;
    return roleId && roleIds.includes(roleId) && positiveInteger(role.tenant_id) === tenantId
      && organizationMatches && role.is_enabled === true && nonEmptyText(role.code, 80)
      ? [role.code] : [];
  }));
  if (!roleCodes.size) forbidden();

  const agent = await maybeSingle(
    client.from<ScopedRow>("agent_definitions")
      .select("id, tenant_id, organization_id, public_id, status, deleted_at, min_job_level, current_version_id, prompt_version, system_prompt, model_code, tool_scope")
      .eq("tenant_id", tenantId).eq("organization_id", organizationId).eq("public_id", agentPublicId)
      .eq("status", "enabled").is("deleted_at", null).maybeSingle(),
    notFound,
  );
  const definitionId = positiveInteger(agent.id);
  const versionDefinitionId = positiveInteger(agent.current_version_id);
  const agentMinimum = positiveInteger(agent.min_job_level);
  const execution = parseAgentExecutionConfig({
    modelCode: agent.model_code,
    promptVersion: agent.prompt_version,
    systemPrompt: agent.system_prompt,
    toolScope: agent.tool_scope,
  });
  if (!definitionId || !versionDefinitionId || positiveInteger(agent.tenant_id) !== tenantId
    || positiveInteger(agent.organization_id) !== organizationId || agent.status !== "enabled"
    || agent.deleted_at !== null || !agentMinimum || agentMinimum > 20 || jobLevel < agentMinimum
    || execution === null) forbidden();

  const permissions = await rows(
    client.from<ScopedRow>("agent_permissions")
      .select("id, tenant_id, organization_id, agent_id, scope_type, department_id, role_code, member_id, min_job_level, expires_at, revoked_at, deleted_at")
      .eq("tenant_id", tenantId).eq("organization_id", organizationId).eq("agent_id", definitionId)
      .is("deleted_at", null),
  );
  const rules = permissions.flatMap((permission): AgentInvocationRule[] => {
    if (positiveInteger(permission.tenant_id) !== tenantId
      || positiveInteger(permission.organization_id) !== organizationId
      || positiveInteger(permission.agent_id) !== definitionId || permission.deleted_at !== null
      || (permission.revoked_at !== null && permission.revoked_at !== undefined)
      || (permission.expires_at !== null && permission.expires_at !== undefined
        && (typeof permission.expires_at !== "string" || Date.parse(permission.expires_at) <= Date.now()))
      || !["all", "dept", "role", "member"].includes(String(permission.scope_type))) return [];
    const minJobLevel = positiveInteger(permission.min_job_level);
    if (!minJobLevel) return [];
    return [{
      scopeType: permission.scope_type as AgentInvocationRule["scopeType"],
      departmentId: permission.department_id === null ? null : positiveInteger(permission.department_id),
      roleCode: typeof permission.role_code === "string" ? permission.role_code : null,
      memberId: permission.member_id === null ? null : positiveInteger(permission.member_id),
      minJobLevel,
    }];
  });
  if (!evaluateAgentInvocationAccess({
    memberId, departmentId, jobLevel, roleCodes: [...roleCodes],
  }, {
    status: agent.status, minJobLevel: agentMinimum, configured: true, rules,
  }).canInvoke) forbidden();

  return {
    definitionId,
    versionDefinitionId,
    tenantId,
    organizationId,
    version: execution.promptVersion,
    systemPrompt: execution.systemPrompt,
    model: execution.model,
    toolCodes: execution.toolCodes,
  };
}
