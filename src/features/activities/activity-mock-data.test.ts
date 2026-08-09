import { describe, expect, it } from "vitest";

import { activityProjectViews } from "@/features/activities/activity-mock-data";
import { mockProjects } from "@/features/projects/mock-data";

describe("activityProjectViews", () => {
  it("reuses existing projects and the milestone/task domain contracts", () => {
    const projectIds = new Set(mockProjects.map(({ id }) => id));

    expect(activityProjectViews.length).toBeGreaterThanOrEqual(3);
    activityProjectViews.forEach((activity) => {
      expect(projectIds.has(activity.project.id)).toBe(true);
      expect(activity.stages.map(({ name }) => name)).toEqual(["策划", "执行", "推广", "复盘"]);
      expect(activity.tasks.every(({ projectId }) => projectId === activity.project.id)).toBe(true);
      expect(activity.owner.id).toBe(activity.project.ownerId);
    });
  });

  it("keeps the activity flow sequential and exposes only one active stage", () => {
    activityProjectViews.forEach((activity) => {
      const activeStages = activity.stages.filter(({ status }) => status === "in_progress");

      expect(activeStages).toHaveLength(1);
      expect(
        activity.stages
          .filter(({ status }) => status === "pending")
          .every(({ progress }) => progress === 0),
      ).toBe(true);
    });
  });
});
