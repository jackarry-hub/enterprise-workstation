import { describe, expect, it } from "vitest";
import { customerDemoActors } from "@/features/demo/customer-demo-data";
import {
  createDemoIdleCommand,
  createDepartmentDemoTasks,
  createDepartmentDemoWorkstreams,
} from "@/features/operations/department-demo-seed";

describe("department demo seed", () => {
  it("creates three completable department workstreams for all ten people", () => {
    const workstreams = createDepartmentDemoWorkstreams();
    const tasks = createDepartmentDemoTasks();
    expect(workstreams).toHaveLength(3);
    expect(new Set(tasks.map((task) => task.assigneeId))).toEqual(
      new Set(customerDemoActors.map((actor) => actor.id)),
    );
    expect(new Set(tasks.map((task) => task.department))).toEqual(
      new Set(customerDemoActors.map((actor) => actor.department)),
    );
    expect(tasks.every((task) => task.runtimeSource === "department_mock")).toBe(true);
    expect(tasks.every((task) => task.workstreamId && task.projectId)).toBe(true);
  });

  it("keeps dependencies informative instead of blocking independent submission", () => {
    expect(createDepartmentDemoTasks().every((task) => task.dependencyIds.length === 0)).toBe(true);
  });

  it("creates an archived idle command while no AI workstream is active", () => {
    expect(createDemoIdleCommand()).toEqual({
      id: "command-idle",
      title: "等待新的 AI 调度",
      summary: "当前没有活动中的 AI 调度工作流。",
      ownerId: "actor-executive",
      status: "archived",
      deadline: "2026-12-31",
      budgetWan: 0,
      createdAt: "2026-08-14T09:00:00.000Z",
      updatedAt: "2026-08-14T09:00:00.000Z",
    });
  });
});
