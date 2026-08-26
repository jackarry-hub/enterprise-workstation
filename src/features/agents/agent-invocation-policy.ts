import { isAllowedAiModel, type AiModel } from "@/features/ai-config/ai-config-types";

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

export type AgentExecutionConfig = {
  model: AiModel;
  promptVersion: string;
  systemPrompt: string;
  toolCodes: string[];
};

const boundaryWhitespace = new Set([" ", "\t", "\n", "\v", "\f", "\r", "\u00a0"]);
const utf8 = new TextEncoder();

function isExecutionText(value: unknown, maxBytes: number): value is string {
  if (typeof value !== "string" || !value.length
    || boundaryWhitespace.has(value[0]) || boundaryWhitespace.has(value.at(-1) ?? "")) return false;
  const byteLength = utf8.encode(value).byteLength;
  return byteLength >= 1 && byteLength <= maxBytes;
}

/** Parses server-owned Agent execution fields and rejects every malformed input. */
export function parseAgentExecutionConfig(value: unknown): AgentExecutionConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isAllowedAiModel(row.modelCode)
    || !isExecutionText(row.promptVersion, 40)
    || !isExecutionText(row.systemPrompt, 12_000)
    || !row.toolScope || typeof row.toolScope !== "object" || Array.isArray(row.toolScope)) return null;
  const tools = (row.toolScope as Record<string, unknown>).tools;
  if (!Array.isArray(tools) || tools.length > 30) return null;
  const unique = new Set<string>();
  for (const tool of tools) {
    if (!isExecutionText(tool, 80) || unique.has(tool)) return null;
    unique.add(tool);
  }
  return {
    model: row.modelCode,
    promptVersion: row.promptVersion,
    systemPrompt: row.systemPrompt,
    toolCodes: [...unique],
  };
}

export function isAgentExecutionReady(value: unknown): boolean {
  return parseAgentExecutionConfig(value) !== null;
}

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
