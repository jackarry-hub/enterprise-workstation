import { describe, expect, it } from "vitest";

import { buildDemoTeamContext } from "@/features/ai-dispatch/demo-team-context";
import { validateDispatchPlan } from "@/features/ai-dispatch/dispatch-contract";
import { validDispatchPlan } from "@/test/ai-dispatch-test-utils";

describe("AI dispatch contract", () => {
  it("builds context from the existing ten-person demo roster with derived workload and status", () => {
    const team = buildDemoTeamContext();

    expect(team).toHaveLength(10);
    expect(team.find(({ name }) => name === "陈晨")).toMatchObject({
      jobTitle: "前端工程师",
      department: "产品研发中心",
      skills: ["前端开发", "系统联调", "自动化"],
      activeTaskCount: 1,
      workload: 25,
      status: "执行中",
    });
    expect(JSON.stringify(team)).not.toMatch(/@demo|138 0000/);
  });

  it("accepts the fixed JSON contract when every person exists in the demo pool", () => {
    expect(validateDispatchPlan(validDispatchPlan, buildDemoTeamContext())).toEqual({
      ok: true,
      plan: validDispatchPlan,
    });
  });

  it("rejects invented employees, mismatched roles, and task counts outside 3 to 8", () => {
    expect(validateDispatchPlan({ ...validDispatchPlan, tasks: validDispatchPlan.tasks.slice(0, 2) }, buildDemoTeamContext())).toMatchObject({ ok: false });
    expect(validateDispatchPlan({
      ...validDispatchPlan,
      tasks: validDispatchPlan.tasks.map((task, index) => index === 0 ? { ...task, assignee: "不存在的人" } : task),
    }, buildDemoTeamContext())).toMatchObject({ ok: false });
    expect(validateDispatchPlan({
      ...validDispatchPlan,
      tasks: validDispatchPlan.tasks.map((task, index) => index === 1 ? { ...task, role: "财务经理" } : task),
    }, buildDemoTeamContext())).toMatchObject({ ok: false });
    expect(validateDispatchPlan({
      ...validDispatchPlan,
      tasks: validDispatchPlan.tasks.map((task, index) => index === 1 ? { ...task, owner: "陈晨" } : task),
    }, buildDemoTeamContext())).toMatchObject({ ok: false });
  });
});
