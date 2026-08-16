import { describe, expect, it } from "vitest";

import { validateExecutionSummary } from "@/features/ai-dispatch/summary-contract";

export const validExecutionSummary = {
  completion: "目标内全部任务均已完成并通过验收。",
  key_achievements: ["移动端 V1 已交付", "关键流程回归通过"],
  team_performance: "团队按职责完成交付，返工后质量达标。",
  issues: ["首轮提交存在小屏溢出问题"],
  lessons: ["在开发阶段提前加入 390px 回归检查"],
  next_steps: ["安排客户试用并收集反馈"],
};

describe("AI execution summary contract", () => {
  it("accepts the fixed summary JSON shape", () => {
    expect(validateExecutionSummary(validExecutionSummary)).toEqual({
      ok: true,
      summary: validExecutionSummary,
    });
  });

  it("rejects missing or oversized fields", () => {
    expect(validateExecutionSummary({ ...validExecutionSummary, completion: "" })).toMatchObject({ ok: false });
    expect(validateExecutionSummary({ ...validExecutionSummary, next_steps: Array(13).fill("x") })).toMatchObject({ ok: false });
  });
});
