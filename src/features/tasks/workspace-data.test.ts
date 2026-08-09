import { describe, expect, it } from "vitest";

import {
  loadWorkspaceData,
  type WorkspaceClientFactory,
} from "@/features/tasks/workspace-data";
import { workspaceMockResult } from "@/features/tasks/workspace-mock-data";

describe("loadWorkspaceData", () => {
  it("uses the complete workspace mock only in explicit demo mode", async () => {
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
  });

  it("keeps the overview metrics consistent with the mock work items", () => {
    expect(workspaceMockResult.data.overview.todayTaskCount).toBe(6);
    expect(workspaceMockResult.data.overview.pendingApprovalCount).toBe(2);
    expect(workspaceMockResult.data.overview.deadlineReminderCount).toBe(3);
    expect(workspaceMockResult.data.overview.weeklyCompletionRate).toBe(82);
  });
});
