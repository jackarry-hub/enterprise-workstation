import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SchedulerWorkspace } from "@/features/ai-scheduler/scheduler-workspace";

describe("scheduler workspace", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("renders a persisted rules plan, missing cost and audited override after refresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ projects: [{ id: "p", name: "客户门户", dueDate: "2026-09-10", status: "active" }], members: [{ projectId: "p", memberId: 8, name: "成员甲", skills: ["nextjs"], openTaskCount: 2 }], goals: [{ id: "g", projectId: "p", objective: "完成上线", createdAt: "2026-08-30T08:00:00Z", override: { reason: "资源冲突", originalMemberId: 7, replacementMemberId: 8 }, plan: { id: "plan", revision: 2, source: "rules", status: "draft", summary: { humanOverride: true }, cost: null, riskSummary: "人工确认", assignments: [{ id: "a", memberId: 8, ordinal: 0, title: "上线验收", description: "完成联调", acceptanceCriteria: "健康检查通过", dueDate: "2026-09-10", priority: "high", evidence: { openTaskCount: 2, taskIds: [] } }] } }] })));
    render(<SchedulerWorkspace />);
    expect(await screen.findByText("规则方案")).toBeInTheDocument();
    expect(screen.getByText("未配置")).toBeInTheDocument();
    expect(screen.getByText("含人工改派")).toBeInTheDocument();
    expect(screen.getByText("人工改派：资源冲突")).toBeInTheDocument();
    expect(screen.getAllByText("上线验收").length).toBeGreaterThan(0);
  });
});
