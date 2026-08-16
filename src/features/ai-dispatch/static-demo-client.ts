import { createDemoFallbackDispatchPlan } from "@/features/ai-dispatch/demo-fallback-plan";
import { buildDemoTeamContext } from "@/features/ai-dispatch/demo-team-context";
import type { AiDispatchPlan } from "@/features/ai-dispatch/dispatch-contract";
import type {
  AiExecutionSummary,
  ExecutionSummaryInput,
} from "@/features/ai-dispatch/summary-contract";

export type StaticDemoDispatchResult = {
  plan: AiDispatchPlan;
  model: "demo-fallback";
  repaired: false;
  mode: "demo";
  source: "demo_fallback";
};

export function isStaticAiDemoBuild() {
  return process.env.NEXT_PUBLIC_STATIC_AI_DEMO === "true";
}

export function createStaticDemoDispatchResult(
  command: string,
  now = new Date(),
): StaticDemoDispatchResult {
  return {
    plan: createDemoFallbackDispatchPlan(command, buildDemoTeamContext(), now),
    model: "demo-fallback",
    repaired: false,
    mode: "demo",
    source: "demo_fallback",
  };
}

export function createStaticDemoExecutionSummary(
  execution: ExecutionSummaryInput,
): AiExecutionSummary {
  const rejectionCount = execution.tasks.reduce(
    (total, task) => total + task.rejection_count,
    0,
  );
  const achievements = execution.tasks
    .slice(0, 4)
    .map((task) => `${task.assignee}完成“${task.title}”并通过验收`);

  return {
    completion: `“${execution.goal}”已完成 ${execution.tasks.length} 项任务并形成完整验收闭环。`,
    key_achievements: achievements,
    team_performance: `团队按责任分工完成全部交付，共经历 ${rejectionCount} 次验收调整，成果已沉淀在当前浏览器。`,
    issues: rejectionCount
      ? [`执行过程中发生 ${rejectionCount} 次退回，后续应在下发前进一步明确验收样例。`]
      : ["本轮未发生验收退回，后续应继续保持短周期检查。"],
    lessons: ["目标、唯一负责人、截止日期和验收口径同时明确时，协作闭环最稳定。"],
    next_steps: ["归档本次执行记录", "复用有效任务模板", "开始下一轮经营目标拆解"],
  };
}
