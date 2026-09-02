import { describe, expect, it } from "vitest";

import { getTaskCenterAction } from "@/features/tasks/task-center-action";

describe("task center role action", () => {
  it.each([
    ["executive", "/dashboard", "返回领导调度台"],
    ["department_head", "/projects", "前往项目管理"],
    ["employee", "/execution", "前往我的执行工作台"],
    ["finance", "/approvals", "前往审批与财务"],
    ["hr", "/people", "前往组织人事"],
  ] as const)("matches the %s role to its own workbench", (role, href, label) => {
    expect(getTaskCenterAction(role)).toEqual({ href, label });
  });
});
