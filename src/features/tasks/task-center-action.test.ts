import { describe, expect, it } from "vitest";

import { getTaskCenterAction } from "@/features/tasks/task-center-action";

describe("task center role action", () => {
  it.each([
    ["executive", "/dashboard", "返回领导调度台"],
    ["department_head", "/department", "前往负责人工作台"],
    ["employee", "/execution", "前往我的执行工作台"],
    ["finance", "/finance", "前往财务执行中心"],
    ["hr", "/hr", "前往人事协同中心"],
  ] as const)("matches the %s role to its own workbench", (role, href, label) => {
    expect(getTaskCenterAction(role)).toEqual({ href, label });
  });
});
