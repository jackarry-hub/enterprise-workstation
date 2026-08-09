import { describe, expect, it } from "vitest";

import {
  filterProjectList,
  getProjectDetailMock,
  getProjectListMock,
  mockFileRelations,
  mockProjectActivities,
  mockProjectRisks,
  mockProjects,
} from "@/features/projects/mock-data";

describe("project collaboration mock data", () => {
  it("builds every project list item with an owner who belongs to the project", () => {
    const list = getProjectListMock();

    expect(list).toHaveLength(mockProjects.length);

    for (const item of list) {
      expect(item.memberCount).toBe(item.members.length);
      expect(item.members.some((member) => member.id === item.owner.id)).toBe(true);
      expect(item.progress).toBeGreaterThanOrEqual(0);
      expect(item.progress).toBeLessThanOrEqual(100);
      expect(item.startDate.localeCompare(item.dueDate)).toBeLessThanOrEqual(0);
      expect(item.priority).toBeTruthy();
    }
  });

  it("supports combined project portfolio filters", () => {
    const list = getProjectListMock();
    const filtered = filterProjectList(list, {
      group: "all",
      query: "发布",
      status: "active",
      priority: "critical",
      ownerId: "all",
      deadline: "all",
    });

    expect(filtered.map(({ name }) => name)).toEqual(["新产品发布活动"]);
  });

  it("returns a relationally consistent detail aggregate", () => {
    const project = mockProjects[0];
    const detail = getProjectDetailMock(project.id);

    expect(detail).toBeDefined();
    expect(detail?.project).toEqual(project);
    expect(detail?.owner.id).toBe(project.ownerId);
    expect(detail?.members.some(({ member }) => member.id === project.ownerId)).toBe(true);

    const milestoneIds = new Set(detail?.milestones.map(({ id }) => id));
    const taskIds = new Set(detail?.tasks.map(({ id }) => id));

    for (const milestone of detail?.milestones ?? []) {
      expect(milestone.projectId).toBe(project.id);
    }

    for (const task of detail?.tasks ?? []) {
      expect(task.projectId).toBe(project.id);
      if (task.milestoneId) {
        expect(milestoneIds.has(task.milestoneId)).toBe(true);
      }
      if (task.parentTaskId) {
        expect(taskIds.has(task.parentTaskId)).toBe(true);
      }
    }

    for (const comment of detail?.comments ?? []) {
      expect(comment.projectId).toBe(project.id);
      expect(taskIds.has(comment.taskId)).toBe(true);
    }

    for (const file of detail?.files ?? []) {
      expect(file.projectId).toBe(project.id);
      if (file.taskId) {
        expect(taskIds.has(file.taskId)).toBe(true);
      }
    }

    for (const report of detail?.dailyReports ?? []) {
      expect(report.projectId).toBe(project.id);
    }

    for (const activity of detail?.activities ?? []) {
      expect(activity.projectId).toBe(project.id);
    }

    for (const risk of detail?.risks ?? []) {
      expect(risk.projectId).toBe(project.id);
      expect(detail?.members.some(({ member }) => member.id === risk.ownerId)).toBe(true);
    }

    const fileIds = new Set(detail?.files.map(({ id }) => id));
    for (const relation of detail?.fileRelations ?? []) {
      expect(relation.projectId).toBe(project.id);
      expect(fileIds.has(relation.fileId)).toBe(true);
    }
  });

  it("keeps project extension mocks relationally valid", () => {
    const projectIds = new Set(mockProjects.map(({ id }) => id));

    expect(mockProjectActivities.length).toBeGreaterThan(0);
    expect(mockProjectRisks.length).toBeGreaterThan(0);
    expect(mockFileRelations.length).toBeGreaterThan(0);

    for (const activity of mockProjectActivities) {
      expect(projectIds.has(activity.projectId)).toBe(true);
      expect(activity.content.trim()).not.toBe("");
    }
  });

  it("returns undefined for a project that is not in the mock data", () => {
    expect(
      getProjectDetailMock("ffffffff-ffff-4fff-8fff-ffffffffffff"),
    ).toBeUndefined();
  });
});
