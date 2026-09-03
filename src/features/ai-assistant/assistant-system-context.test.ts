// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildAssistantProviderMessages,
  loadAssistantWorkspaceContext,
  type AssistantWorkspaceContextSource,
} from "@/features/ai-assistant/assistant-system-context";

describe("AI assistant server-owned workspace context", () => {
  const source: AssistantWorkspaceContextSource = {
    organization: async () => ({ id: 7, name: "量子星河" }),
    departments: async () => [
      { id: 11, name: "管理中心", parentDepartmentId: null, status: "active" },
      { id: 12, name: "技术部", parentDepartmentId: 11, status: "active" },
      { id: 13, name: "已停用部门", parentDepartmentId: null, status: "disabled" },
    ],
    employees: async () => [
      { departmentId: 11, jobTitle: "CEO", employmentStatus: "active" },
      { departmentId: 12, jobTitle: "工程师", employmentStatus: "probation" },
      { departmentId: 12, jobTitle: "工程师", employmentStatus: "terminated" },
    ],
  };

  it("summarizes only active, permission-visible organization facts", async () => {
    const context = JSON.parse(await loadAssistantWorkspaceContext(source, {
      organization: { id: "00000000-0000-4000-8000-000000000007", name: "量子星河" },
    })) as Record<string, unknown>;
    expect(context).toMatchObject({
      status: "ready", departmentCount: 2, visibleEmployeeCount: 2,
      unassignedVisibleEmployeeCount: 0,
    });
    expect(context.departments).toEqual([
      { name: "管理中心", parent: null, visibleEmployeeCount: 1, jobTitles: ["CEO"] },
      { name: "技术部", parent: "管理中心", visibleEmployeeCount: 1, jobTitles: ["工程师"] },
    ]);
  });

  it("makes the latest user turn authoritative without losing durable history", () => {
    const messages = buildAssistantProviderMessages([
      { role: "user", content: "只回复固定文字" },
      { role: "assistant", content: "固定文字" },
      { role: "user", content: "现在公司的架构是什么？" },
    ], "{\"status\":\"ready\"}");
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[0].content).toContain("最后一条用户消息");
    expect(messages[0].content).toContain("一次性格式");
    expect(messages.at(-1)).toEqual({ role: "user", content: "现在公司的架构是什么？" });
  });
});
