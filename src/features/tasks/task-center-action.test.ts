import { describe, expect, it } from "vitest";

import { getTaskCenterAction } from "@/features/tasks/task-center-action";

describe("task center role action", () => {
  it.each([
    ["executive", "/execution", "前往我的执行工作台"],
    ["department_head", "/department", "前往负责人工作台"],
    ["employee", "/execution", "前往我的执行工作台"],
    ["finance", "/finance", "前往财务执行中心"],
    ["hr", "/hr", "前往人事协同中心"],
  ] as const)("matches the %s role to its own workbench", (role, href, label) => {
    expect(getTaskCenterAction(role)).toEqual({ href, label });
  });

  it("links a selected employee task directly to its operation card", () => {
    expect(getTaskCenterAction("employee", "flow-task-10")).toEqual({
      href: "/execution#task-flow-task-10",
      label: "直接办理当前任务",
    });
  });

  it("lets a decision maker directly execute a task assigned to them", () => {
    expect(getTaskCenterAction("executive", "ai-task-01")).toEqual({
      href: "/execution#task-ai-task-01",
      label: "直接办理当前任务",
    });
  });

  it("builds review links that target the review section", () => {
    expect(getTaskCenterAction("executive", "task-1", "review")).toEqual({
      href: "/execution#review-task-1",
      label: "直接验收当前任务",
    });
  });
});
