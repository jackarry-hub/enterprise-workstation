import { describe, expect, it } from "vitest";

import {
  addMockTaskComment,
  calculateProjectProgress,
  createMockTask,
  updateMockTaskStatus,
} from "@/features/projects/data/project-task-operations";
import { getProjectDetailMock, mockProjects } from "@/features/projects/mock-data";
import type { ProjectTask, TaskStatus } from "@/features/projects/types";

function getDetailFixture() {
  const fixture = getProjectDetailMock(mockProjects[0].id);
  if (!fixture) {
    throw new Error("Expected a project detail fixture.");
  }
  return fixture;
}

const detail = getDetailFixture();

function task(status: TaskStatus): ProjectTask {
  return {
    ...detail.tasks[0],
    id: `task-${status}`,
    status,
    progress: status === "done" ? 100 : 0,
  };
}

describe("project task operations", () => {
  it.each([
    [[], 0],
    [[task("done"), task("todo")], 50],
    [[task("done"), task("cancelled")], 100],
    [[task("done"), task("todo"), task("in_progress")], 33],
  ])("calculates progress from non-cancelled tasks", (tasks, expected) => {
    expect(calculateProjectProgress(tasks)).toBe(expected);
  });

  it("creates an assigned todo task and recalculates project progress", () => {
    const assignee = detail.members[1].member;
    const next = createMockTask(detail, {
      title: "完成客户门户原型",
      description: "覆盖登录后首页与项目进度页",
      assigneeId: assignee.id,
      dueDate: "2026-08-28",
      priority: "high",
    }, {
      now: () => new Date("2026-08-05T03:00:00.000Z"),
      createId: () => "task-local-1",
    });

    expect(next).not.toBe(detail);
    expect(next.tasks.at(-1)).toMatchObject({
      id: "task-local-1",
      title: "完成客户门户原型",
      assigneeId: assignee.id,
      status: "todo",
      progress: 0,
      sortOrder: 3,
    });
    expect(next.project.progress).toBe(0);
    expect(detail.tasks).toHaveLength(3);
  });

  it("rejects an assignee outside the current project", () => {
    expect(() => createMockTask(detail, {
      title: "无效负责人任务",
      description: "不应创建",
      assigneeId: "member-outside-project",
      dueDate: "2026-08-28",
      priority: "medium",
    })).toThrow("负责人必须是当前项目成员");
  });

  it("marks a task done and sets completion metadata", () => {
    const taskId = detail.tasks[0].id;
    const next = updateMockTaskStatus(detail, taskId, "done", {
      now: () => new Date("2026-08-05T04:00:00.000Z"),
    });

    expect(next.tasks[0]).toMatchObject({ status: "done", progress: 100 });
    expect(next.tasks[0].completedAt).toBe("2026-08-05T04:00:00.000Z");
    expect(next.project.progress).toBe(33);
  });

  it("clears completion metadata when a completed task returns to progress", () => {
    const completed = updateMockTaskStatus(detail, detail.tasks[0].id, "done", {
      now: () => new Date("2026-08-05T04:00:00.000Z"),
    });
    const reopened = updateMockTaskStatus(completed, detail.tasks[0].id, "in_progress", {
      now: () => new Date("2026-08-05T05:00:00.000Z"),
    });

    expect(reopened.tasks[0]).toMatchObject({ status: "in_progress", progress: 50 });
    expect(reopened.tasks[0].completedAt).toBeUndefined();
    expect(reopened.project.progress).toBe(0);
  });

  it("returns the same aggregate when the task does not exist", () => {
    expect(updateMockTaskStatus(detail, "missing-task", "done")).toBe(detail);
  });

  it("adds a task comment and a corresponding project activity", () => {
    const next = addMockTaskComment(detail, detail.tasks[0].id, "已完成联调，请确认。", {
      now: () => new Date("2026-08-05T06:00:00.000Z"),
      createId: (() => { let index = 0; return () => `generated-${++index}`; })(),
    });

    expect(next.comments.at(-1)).toMatchObject({ body: "已完成联调，请确认。", taskId: detail.tasks[0].id });
    expect(next.activities[0].content).toContain("评论了任务");
  });
});
