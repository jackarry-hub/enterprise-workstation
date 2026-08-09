import { describe, expect, it } from "vitest";

import { getDefaultProjectDetails } from "@/features/projects/data/effective-project-details";
import { mockMembers } from "@/features/projects/mock-data";
import {
  buildAnalyticsTrend,
  buildAnalyticsViewModel,
} from "@/features/analytics/analytics-selectors";

const projects = getDefaultProjectDetails();

describe("analytics selectors", () => {
  it("derives project and task statistics from the effective project set", () => {
    const result = buildAnalyticsViewModel(projects, mockMembers, {
      range: "month",
      department: "all",
    });

    expect(result.summary.projectCount).toBe(projects.length);
    expect(result.summary.activeProjectCount).toBe(
      projects.filter(({ project }) => project.status === "active").length,
    );
    expect(result.summary.taskCompletionRate).toBeGreaterThanOrEqual(0);
    expect(result.summary.activeEmployeeCount).toBeGreaterThan(0);
  });

  it("recalculates execution rows when a department is selected", () => {
    const department = mockMembers[0].department;
    const result = buildAnalyticsViewModel(projects, mockMembers, {
      range: "quarter",
      department,
    });

    expect(result.executionRows.length).toBeGreaterThan(0);
    expect(result.executionRows.every((row) => row.department === department)).toBe(true);
  });

  it("returns deterministic trend points for identical input", () => {
    expect(buildAnalyticsTrend(projects, "half_year")).toEqual(
      buildAnalyticsTrend(projects, "half_year"),
    );
  });

  it("provides delivery, risk, and health panels for the approved layout", () => {
    const result = buildAnalyticsViewModel(projects, mockMembers, {
      range: "month",
      department: "all",
    });

    expect(result.deliveryCalendar.length).toBeGreaterThan(0);
    expect(result.riskReminders.length).toBeGreaterThan(0);
    expect(result.healthDistribution.reduce((sum, item) => sum + item.value, 0)).toBe(projects.length);
  });
});
