import { describe, expect, it } from "vitest";

import {
  createStaticDemoDispatchResult,
  createStaticDemoExecutionSummary,
} from "@/features/ai-dispatch/static-demo-client";

describe("static GitHub Pages AI demo", () => {
  it("creates a labeled local dispatch plan without a server request", () => {
    const result = createStaticDemoDispatchResult(
      "目标：一周内完成官网升级\n截止日期：2026-08-23",
      new Date("2026-08-16T00:00:00.000Z"),
    );

    expect(result).toMatchObject({
      model: "demo-fallback",
      source: "demo_fallback",
      mode: "demo",
    });
    expect(result.plan.tasks).toHaveLength(5);
    expect(result.plan.summary).toContain("本地演示规则");
  });

  it("creates a complete local execution summary", () => {
    const summary = createStaticDemoExecutionSummary({
      goal: "完成官网升级",
      tasks: [{
        title: "上线新版官网",
        assignee: "周然",
        status: "done",
        submission: "新版页面已发布",
        review_comment: "验收通过",
        rejection_count: 0,
      }],
    });

    expect(summary.completion).toContain("已完成 1 项任务");
    expect(summary.key_achievements[0]).toContain("周然");
    expect(summary.next_steps.length).toBeGreaterThan(0);
  });
});
