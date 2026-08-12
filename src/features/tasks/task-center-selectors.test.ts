import { describe, expect, it } from "vitest";

import { getDefaultProjectDetails } from "@/features/projects/data/effective-project-details";
import { mockMembers } from "@/features/projects/mock-data";
import { operationFixtureActors } from "@/features/operations/operations-data";
import type { ProjectTask, TaskStatus } from "@/features/projects/types";
import {
  calculateTaskCenterCompletionRate,
  createTaskCenterItems,
  filterTaskCenterItems,
  getAssigneeDistribution,
  getUpcomingTaskDeadlines,
  selectMyTaskItems,
  scopeTaskCenterItems,
  toTaskCenterStatus,
} from "@/features/tasks/task-center-selectors";

const projects = getDefaultProjectDetails();

function task(status: TaskStatus): ProjectTask {
  return {
    ...projects[0].tasks[0],
    id: `task-${status}`,
    status,
  };
}

describe("task center selectors", () => {
  it("flattens project tasks with their project and member context", () => {
    const items = createTaskCenterItems(projects);

    expect(items).toHaveLength(projects.reduce((sum, detail) => sum + detail.tasks.length, 0));
    expect(items[0]).toMatchObject({
      project: { id: projects[0].project.id },
      task: { id: projects[0].tasks[0].id },
      assignee: { id: projects[0].tasks[0].assigneeId },
    });
  });

  it.each([
    ["backlog", "pending"],
    ["todo", "pending"],
    ["in_progress", "in_progress"],
    ["in_review", "in_progress"],
    ["done", "done"],
    ["cancelled", "cancelled"],
  ] as const)("maps %s into the %s page group", (status, expected) => {
    expect(toTaskCenterStatus(status)).toBe(expected);
  });

  it("filters query, project, assignee, priority, and status together", () => {
    const target = createTaskCenterItems(projects).find(
      ({ task: item }) => item.title === "整理并迁移品牌内容",
    );
    expect(target).toBeDefined();
    if (!target?.assignee) {
      return;
    }

    const result = filterTaskCenterItems(createTaskCenterItems(projects), {
      query: "品牌内容",
      tab: "pending",
      projectId: target.project.id,
      assigneeId: target.assignee.id,
      priority: target.task.priority,
    });

    expect(result.map(({ task: item }) => item.id)).toEqual([target.task.id]);
  });

  it("includes only tasks assigned to the current member", () => {
    const result = selectMyTaskItems(createTaskCenterItems(projects), mockMembers[3].id);

    expect(result.length).toBeGreaterThan(0);
    expect(result.every(({ task: item }) => item.assigneeId === mockMembers[3].id)).toBe(true);
  });

  it("scopes the task center to tasks uniquely assigned to the signed-in person", () => {
    const items = createTaskCenterItems(projects);
    const employee = operationFixtureActors.find(({ id }) => id === "actor-employee");
    const manager = operationFixtureActors.find(({ id }) => id === "actor-manager");
    expect(employee).toBeDefined();
    expect(manager).toBeDefined();
    if (!employee || !manager) return;

    const employeeItems = scopeTaskCenterItems(items, employee);
    const managerItems = scopeTaskCenterItems(items, manager);

    expect(employeeItems.every(({ task: item }) => item.assigneeId === employee.memberId)).toBe(true);
    expect(managerItems.every(({ task: item }) => item.assigneeId === manager.memberId)).toBe(true);
    expect(managerItems.some(({ assignee }) => assignee?.displayName !== manager.name)).toBe(false);
  });

  it("excludes cancelled tasks from the completion denominator", () => {
    expect(calculateTaskCenterCompletionRate([
      task("done"),
      task("todo"),
      task("cancelled"),
    ])).toBe(50);
  });

  it("aggregates assignee distribution and sorts upcoming deadlines", () => {
    const items = createTaskCenterItems(projects);
    const distribution = getAssigneeDistribution(items);
    const deadlines = getUpcomingTaskDeadlines(items);

    expect(distribution[0].taskCount).toBeGreaterThanOrEqual(distribution.at(-1)?.taskCount ?? 0);
    expect(deadlines.map(({ task: item }) => item.dueDate)).toEqual(
      [...deadlines.map(({ task: item }) => item.dueDate)].sort(),
    );
  });
});
