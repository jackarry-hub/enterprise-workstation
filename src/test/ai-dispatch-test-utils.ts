import type { AiDispatchPlan } from "@/features/ai-dispatch/dispatch-contract";

export const validDispatchPlan: AiDispatchPlan = {
  goal: "3天内完成AI企业大脑移动端V1",
  summary: "聚焦移动端核心流程并完成可演示版本。",
  estimated_days: 3,
  risk_level: "medium",
  tasks: [
    { title: "确认移动端范围", description: "锁定一屏核心信息与验收口径。", owner: "张伟", assignee: "张伟", role: "产品技术总监", priority: "high", deadline: "2026-08-14", estimated_hours: 4, dependencies: [], reason: "负责产品与技术范围确认。" },
    { title: "完成移动端开发", description: "实现首页与任务核心交互。", owner: "张伟", assignee: "陈晨", role: "前端工程师", priority: "urgent", deadline: "2026-08-15", estimated_hours: 16, dependencies: ["确认移动端范围"], reason: "具备前端开发与系统联调能力。" },
    { title: "执行回归测试", description: "覆盖手机尺寸与关键闭环。", owner: "张伟", assignee: "郭敏", role: "测试工程师", priority: "high", deadline: "2026-08-16", estimated_hours: 8, dependencies: ["完成移动端开发"], reason: "负责质量保障与验收证据。" },
  ],
  risks: ["三天周期紧，需要每天确认范围。"],
  manager_decisions: ["确认V1不包含真实任务分发。"],
};

