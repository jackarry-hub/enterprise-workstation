import type {
  AiDispatchPlan,
  DemoTeamMemberContext,
  DispatchPriority,
} from "@/features/ai-dispatch/dispatch-contract";

const taskTemplates = [
  ["确认目标与验收口径", "把经营目标、交付边界和验收标准整理成一页确认清单。"],
  ["制定执行方案", "明确交付范围、推进顺序、关键资源和阶段检查点。"],
  ["完成核心交付", "按照确认后的方案完成核心工作并提交可核验成果。"],
  ["组织质量验收", "检查关键流程、交付质量和遗留问题，形成验收记录。"],
  ["上线交付与复盘", "完成最终交付，记录结果、风险和下一轮改进事项。"],
] as const;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function deadlineFromCommand(command: string, now: Date) {
  const configured = command.match(/截止日期[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const parsed = configured ? new Date(`${configured}T00:00:00Z`) : addDays(now, 7);
  return Number.isNaN(parsed.valueOf()) || parsed < now ? addDays(now, 7) : parsed;
}

export function createDemoFallbackDispatchPlan(
  command: string,
  team: readonly DemoTeamMemberContext[],
  now = new Date(),
): AiDispatchPlan {
  const owner = team.find(({ canDispatch, jobTitle }) => canDispatch && !jobTitle.toUpperCase().includes("CEO"))
    ?? team.find(({ canDispatch }) => canDispatch)
    ?? team[0];
  if (!owner) throw new Error("演示员工池为空");

  const assignees = team.filter(({ jobTitle }) => !jobTitle.toUpperCase().includes("CEO"));
  const available = assignees.length ? assignees : [owner];
  const finalDeadline = deadlineFromCommand(command, now);
  const totalDays = Math.max(1, Math.ceil((finalDeadline.valueOf() - now.valueOf()) / 86_400_000));
  const goal = command.match(/目标[：:]\s*([^\n]+)/)?.[1]?.trim() || command.trim().slice(0, 300);

  const tasks = taskTemplates.map(([title, description], index) => {
    const assignee = available[index % available.length];
    const dayOffset = Math.max(1, Math.round(((index + 1) / taskTemplates.length) * totalDays));
    const priority: DispatchPriority = index === 2 ? "urgent" : index < 2 ? "high" : "medium";
    return {
      title,
      description: `${description} 当前目标：${goal}`.slice(0, 600),
      owner: owner.name,
      assignee: assignee.name,
      role: assignee.jobTitle,
      priority,
      deadline: isoDate(dayOffset >= totalDays ? finalDeadline : addDays(now, dayOffset)),
      estimated_hours: index === 2 ? 16 : 6,
      dependencies: index ? [taskTemplates[index - 1][0]] : [],
      reason: `${assignee.name}的岗位为${assignee.jobTitle}，适合负责此阶段交付。`,
    };
  });

  return {
    goal,
    summary: "当前运行环境无法访问 DeepSeek，系统已用本地演示规则生成可继续审核、下发的任务方案。",
    estimated_days: totalDays,
    risk_level: "medium",
    tasks,
    risks: ["本方案为离线演示结果；恢复外网后应重新调用 DeepSeek 生成正式建议。"],
    manager_decisions: ["请确认交付范围、负责人和最终验收口径后再下发任务。"],
  };
}
