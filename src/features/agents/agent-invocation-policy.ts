export type AgentInvocationSubject = {
  memberId: number;
  departmentId: number;
  jobLevel: number;
  roleCodes: readonly string[];
};

export type AgentInvocationRule = {
  scopeType: "all" | "dept" | "role" | "member";
  departmentId: number | null;
  roleCode: string | null;
  memberId: number | null;
  minJobLevel: number;
};

export type AgentInvocationDefinition = {
  status: string;
  minJobLevel: number;
  configured: boolean;
  rules: readonly AgentInvocationRule[];
};

export type AgentInvocationAccess = {
  canInvoke: boolean;
  reason: "" | "agent_disabled" | "agent_not_configured" | "agent_forbidden";
};

function validLevel(level: number) {
  return Number.isSafeInteger(level) && level >= 1 && level <= 20;
}

function matchesRule(
  subject: AgentInvocationSubject,
  rule: AgentInvocationRule,
  roles: ReadonlySet<string>,
) {
  if (!validLevel(rule.minJobLevel) || subject.jobLevel < rule.minJobLevel) return false;
  switch (rule.scopeType) {
    case "all":
      return rule.departmentId === null && rule.roleCode === null && rule.memberId === null;
    case "dept":
      return rule.departmentId === subject.departmentId && rule.roleCode === null && rule.memberId === null;
    case "role":
      return rule.departmentId === null && rule.memberId === null
        && typeof rule.roleCode === "string" && roles.has(rule.roleCode);
    case "member":
      return rule.departmentId === null && rule.roleCode === null && rule.memberId === subject.memberId;
  }
}

export function evaluateAgentInvocationAccess(
  subject: AgentInvocationSubject,
  definition: AgentInvocationDefinition,
): AgentInvocationAccess {
  if (definition.status !== "enabled") return { canInvoke: false, reason: "agent_disabled" };
  if (!definition.configured || !validLevel(definition.minJobLevel)
    || !validLevel(subject.jobLevel) || subject.jobLevel < definition.minJobLevel) {
    return { canInvoke: false, reason: "agent_not_configured" };
  }
  const roles = new Set(subject.roleCodes);
  return definition.rules.some((rule) => matchesRule(subject, rule, roles))
    ? { canInvoke: true, reason: "" }
    : { canInvoke: false, reason: "agent_forbidden" };
}
