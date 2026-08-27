import { afterEach, describe, expect, it, vi } from "vitest";

import { getProjectDetailMock, mockProjects } from "@/features/projects/mock-data";

const collection = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("@/features/projects/data/project-collection-data", () => ({
  loadProjectCollection: collection.load,
}));

import {
  loadWorkspaceData,
  type WorkspaceClientFactory,
} from "@/features/tasks/workspace-data";
import { workspaceMockResult } from "@/features/tasks/workspace-mock-data";

describe("loadWorkspaceData", () => {
  afterEach(() => {
    collection.load.mockReset();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("uses the complete workspace mock only in explicit demo mode", async () => {
    vi.stubEnv("WORKSTATION_ALLOW_MOCK_DATA", "true");
    const result = await loadWorkspaceData(
      async () => {
        throw new Error("Supabase configuration missing");
      },
      { allowMockFallback: true },
    );

    expect(result.source).toBe("mock");
    expect(result.data.tasks.length).toBeGreaterThan(0);
    expect(result.data.todos.some(({ type }) => type === "approval")).toBe(true);
    expect(result.data.dailyReport.todayCompleted).not.toBe("");
  });

  it("does not disguise a configured Supabase failure with mock data", async () => {
    const result = await loadWorkspaceData(
      (async () => {
        throw new Error("permission denied");
      }) as WorkspaceClientFactory,
      { allowMockFallback: false },
    );

    expect(result.source).toBe("supabase");
    expect(result.data.tasks).toEqual([]);
    expect(result.data.loadError).toBeTruthy();
    expect(result.data.approvalLoadError).toBeTruthy();
    expect(result.data.dailyReportLoadError).toContain("无法确认");
  });

  it("keeps the overview metrics consistent with the mock work items", () => {
    expect(workspaceMockResult.data.overview.todayTaskCount).toBe(6);
    expect(workspaceMockResult.data.overview.pendingApprovalCount).toBe(2);
    expect(workspaceMockResult.data.overview.deadlineReminderCount).toBe(3);
    expect(workspaceMockResult.data.overview.weeklyCompletionRate).toBe(82);
  });

  it("uses the exact actionable approval count and restores the submitted report through public-ID RPCs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T04:00:00.000Z"));
    const detail = getProjectDetailMock(mockProjects[0].id);
    if (!detail) throw new Error("missing project fixture");
    const viewer = {
      ...detail.members[0].member,
      employeePublicId: "a1000000-0000-4000-8000-000000000010",
      commandId: "m101",
    };
    collection.load.mockResolvedValue({
      source: "supabase",
      viewer: { memberId: viewer.id, member: viewer },
      availableMembers: [viewer],
      details: [{
        ...detail,
        tasks: [
          { ...detail.tasks[0], id: "weekly-done", assigneeId: viewer.id, dueDate: "2026-08-28", status: "done", progress: 100 },
          { ...detail.tasks[0], id: "weekly-open", assigneeId: viewer.id, dueDate: "2026-08-29", status: "in_progress", progress: 50 },
          { ...detail.tasks[0], id: "outside-week", assigneeId: viewer.id, dueDate: "2026-09-02", status: "done", progress: 100 },
        ],
      }],
    });
    const rpc = vi.fn(async (name: string) => name === "current_actionable_approval_inbox"
      ? { data: [{
        public_id: "a1000000-0000-4000-8000-000000000020",
        title: "采购审批",
        current_step: "负责人审批",
        submitted_at: "2026-08-27T02:00:00.000Z",
        total_count: 12,
      }], error: null }
      : { data: [{
        project_id: detail.project.id,
        summary: "完成真实联调",
        next_plan: "执行验收",
        blockers: "等待客户确认",
      }], error: null });
    const result = await loadWorkspaceData(
      (async () => ({ rpc })) as unknown as WorkspaceClientFactory,
      { allowMockFallback: false },
    );

    expect(result.data.overview.pendingApprovalCount).toBe(12);
    expect(result.data.overview.weeklyCompletionRate).toBe(50);
    expect(result.data.todos.filter(({ type }) => type === "approval")).toHaveLength(1);
    expect(result.data.dailyReport).toEqual({
      projectId: detail.project.id,
      todayCompleted: "完成真实联调",
      tomorrowPlan: "执行验收",
      blockers: "等待客户确认",
      submitted: true,
    });
  });

  it("keeps project tasks visible when the optional approval query fails", async () => {
    const detail = getProjectDetailMock(mockProjects[0].id);
    if (!detail) throw new Error("missing project fixture");
    const viewer = { ...detail.members[0].member, employeePublicId: "a1000000-0000-4000-8000-000000000011", commandId: "m101" };
    collection.load.mockResolvedValue({
      source: "supabase",
      viewer: { memberId: viewer.id, member: viewer },
      availableMembers: [viewer],
      details: [{ ...detail, tasks: [{ ...detail.tasks[0], assigneeId: viewer.id }] }],
    });
    const rpc = vi.fn(async (name: string) => name === "current_actionable_approval_inbox"
      ? { data: null, error: new Error("approval unavailable") }
      : { data: [], error: null });

    const result = await loadWorkspaceData(
      (async () => ({ rpc })) as unknown as WorkspaceClientFactory,
      { allowMockFallback: false },
    );

    expect(result.data.loadError).toBeUndefined();
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.overview.pendingApprovalCount).toBe(0);
    expect(result.data.approvalLoadError).toContain("暂时不可用");
    expect(result.data.dailyReportLoadError).toBeUndefined();
  });
});
