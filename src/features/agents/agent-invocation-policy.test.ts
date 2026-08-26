import { describe, expect, it } from "vitest";

import {
  evaluateAgentInvocationAccess,
  isAgentExecutionReady,
  parseAgentExecutionConfig,
} from "@/features/agents/agent-invocation-policy";

const subject = {
  memberId: 10,
  departmentId: 44,
  jobLevel: 5,
  roleCodes: ["employee"],
};

describe("evaluateAgentInvocationAccess", () => {
  it("fails closed for every malformed execution configuration without throwing", () => {
    const ready = {
      modelCode: "deepseek-chat",
      promptVersion: "v20",
      systemPrompt: "Server-owned system prompt",
      toolScope: { tools: ["task.read", "knowledge.search"] },
    };
    expect(parseAgentExecutionConfig(ready)).toEqual({
      model: "deepseek-chat",
      promptVersion: "v20",
      systemPrompt: "Server-owned system prompt",
      toolCodes: ["task.read", "knowledge.search"],
    });
    for (const malformed of [
      { ...ready, modelCode: "browser-model" },
      { ...ready, promptVersion: " v20" },
      { ...ready, promptVersion: "v".repeat(41) },
      { ...ready, systemPrompt: " ".repeat(12_001) },
      { ...ready, toolScope: { tools: [" task.read"] } },
      { ...ready, toolScope: { tools: ["task.read", "task.read"] } },
      { ...ready, toolScope: { tools: "task.read" } },
      { ...ready, toolScope: 42 },
      null,
      "not-an-object",
    ]) {
      expect(() => isAgentExecutionReady(malformed)).not.toThrow();
      expect(isAgentExecutionReady(malformed)).toBe(false);
      expect(parseAgentExecutionConfig(malformed)).toBeNull();
    }
  });

  it("uses the exact UTF-8 byte and boundary-whitespace execution text contract", () => {
    const ready = {
      modelCode: "deepseek-chat",
      promptVersion: "v1",
      systemPrompt: "Server-owned system prompt",
      toolScope: { tools: ["task.read"] },
    };
    for (const boundary of [" ", "\t", "\n", "\v", "\f", "\r", "\u00a0"]) {
      expect(isAgentExecutionReady({ ...ready, promptVersion: `${boundary}v1` })).toBe(false);
      expect(isAgentExecutionReady({ ...ready, toolScope: { tools: [`task.read${boundary}`] } })).toBe(false);
    }
    expect(isAgentExecutionReady({ ...ready, promptVersion: "😀".repeat(10) })).toBe(true);
    expect(isAgentExecutionReady({ ...ready, promptVersion: "😀".repeat(11) })).toBe(false);
    expect(isAgentExecutionReady({ ...ready, systemPrompt: "😀".repeat(3_000) })).toBe(true);
    expect(isAgentExecutionReady({ ...ready, systemPrompt: "😀".repeat(3_001) })).toBe(false);
    expect(isAgentExecutionReady({ ...ready, toolScope: { tools: ["😀".repeat(20)] } })).toBe(true);
    expect(isAgentExecutionReady({ ...ready, toolScope: { tools: ["😀".repeat(21)] } })).toBe(false);
    expect(isAgentExecutionReady({ ...ready, promptVersion: "\u2003v1" })).toBe(true);
  });

  it("does not let a member-only grant authorize another employee", () => {
    expect(evaluateAgentInvocationAccess(subject, {
      status: "enabled", minJobLevel: 1, configured: true,
      rules: [{ scopeType: "member", memberId: 11, departmentId: null, roleCode: null, minJobLevel: 1 }],
    })).toEqual({ canInvoke: false, reason: "agent_forbidden" });
  });

  it("requires each matching rule to meet its own job level", () => {
    expect(evaluateAgentInvocationAccess(subject, {
      status: "enabled", minJobLevel: 1, configured: true,
      rules: [
        { scopeType: "member", memberId: 10, departmentId: null, roleCode: null, minJobLevel: 6 },
        { scopeType: "dept", memberId: null, departmentId: 44, roleCode: null, minJobLevel: 7 },
      ],
    })).toEqual({ canInvoke: false, reason: "agent_forbidden" });
  });

  it("authorizes a matching department rule and applies a member rule minimum independently", () => {
    expect(evaluateAgentInvocationAccess(subject, {
      status: "enabled", minJobLevel: 1, configured: true,
      rules: [{ scopeType: "dept", memberId: null, departmentId: 44, roleCode: null, minJobLevel: 5 }],
    })).toEqual({ canInvoke: true, reason: "" });
    expect(evaluateAgentInvocationAccess(subject, {
      status: "enabled", minJobLevel: 1, configured: true,
      rules: [{ scopeType: "member", memberId: 10, departmentId: null, roleCode: null, minJobLevel: 6 }],
    })).toEqual({ canInvoke: false, reason: "agent_forbidden" });
  });

  it("authorizes valid role and department rules but never disabled or invalid definitions", () => {
    const roleRule = { scopeType: "role" as const, memberId: null, departmentId: null, roleCode: "employee", minJobLevel: 5 };
    expect(evaluateAgentInvocationAccess(subject, {
      status: "enabled", minJobLevel: 5, configured: true, rules: [roleRule],
    })).toEqual({ canInvoke: true, reason: "" });
    expect(evaluateAgentInvocationAccess(subject, {
      status: "disabled", minJobLevel: 1, configured: true, rules: [roleRule],
    })).toEqual({ canInvoke: false, reason: "agent_disabled" });
    expect(evaluateAgentInvocationAccess(subject, {
      status: "enabled", minJobLevel: 1, configured: false, rules: [roleRule],
    })).toEqual({ canInvoke: false, reason: "agent_not_configured" });
  });
});
