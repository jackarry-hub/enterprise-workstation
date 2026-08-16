export type DispatchRiskLevel = "low" | "medium" | "high";
export type DispatchPriority = "low" | "medium" | "high" | "urgent";

export type DemoTeamMemberContext = {
  name: string;
  jobTitle: string;
  department: string;
  skills: string[];
  responsibility: string;
  workload: number;
  activeTaskCount: number;
  status: "可接受任务" | "执行中" | "满负荷";
  canDispatch: boolean;
};

export type AiDispatchTask = {
  title: string;
  description: string;
  owner: string;
  assignee: string;
  role: string;
  priority: DispatchPriority;
  deadline: string;
  estimated_hours: number;
  dependencies: string[];
  reason: string;
};

export type AiDispatchPlan = {
  goal: string;
  summary: string;
  estimated_days: number;
  risk_level: DispatchRiskLevel;
  tasks: AiDispatchTask[];
  risks: string[];
  manager_decisions: string[];
};

export type DispatchValidationResult =
  | { ok: true; plan: AiDispatchPlan }
  | { ok: false; issues: string[] };

const priorities = new Set<DispatchPriority>(["low", "medium", "high", "urgent"]);
const riskLevels = new Set<DispatchRiskLevel>(["low", "medium", "high"]);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max = 600): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function textArray(value: unknown, maxItems: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => text(item, 300));
}

function validDate(value: unknown): value is string {
  if (!text(value, 10) || !isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validateDispatchPlan(
  value: unknown,
  team: readonly DemoTeamMemberContext[],
): DispatchValidationResult {
  const raw = object(value);
  const issues: string[] = [];
  if (!raw) return { ok: false, issues: ["返回内容不是 JSON 对象"] };

  if (!text(raw.goal, 300)) issues.push("goal 必须是非空文本");
  if (!text(raw.summary, 600)) issues.push("summary 必须是非空文本");
  if (!Number.isInteger(raw.estimated_days) || Number(raw.estimated_days) < 1 || Number(raw.estimated_days) > 365) {
    issues.push("estimated_days 必须是 1 到 365 的整数");
  }
  if (typeof raw.risk_level !== "string" || !riskLevels.has(raw.risk_level as DispatchRiskLevel)) {
    issues.push("risk_level 必须是 low、medium 或 high");
  }
  if (!textArray(raw.risks, 12)) issues.push("risks 必须是文本数组");
  if (!textArray(raw.manager_decisions, 12)) issues.push("manager_decisions 必须是文本数组");

  if (!Array.isArray(raw.tasks) || raw.tasks.length < 3 || raw.tasks.length > 8) {
    issues.push("tasks 必须包含 3 到 8 项任务");
  } else {
    const peopleByName = new Map(team.map((person) => [person.name, person]));
    const titles = raw.tasks.flatMap((task) => {
      const taskObject = object(task);
      return taskObject && text(taskObject.title, 120) ? [taskObject.title] : [];
    });
    if (new Set(titles).size !== raw.tasks.length) issues.push("任务标题必须非空且不能重复");

    raw.tasks.forEach((task, index) => {
      const item = object(task);
      const prefix = `tasks[${index}]`;
      if (!item) {
        issues.push(`${prefix} 必须是对象`);
        return;
      }
      if (!text(item.title, 120)) issues.push(`${prefix}.title 不合法`);
      if (!text(item.description, 600)) issues.push(`${prefix}.description 不合法`);
      const owner = text(item.owner, 80) ? peopleByName.get(item.owner) : undefined;
      if (!owner) issues.push(`${prefix}.owner 不在演示员工池`);
      else if (!owner.canDispatch) issues.push(`${prefix}.owner 必须是负责人或决策者`);
      const assignee = text(item.assignee, 80) ? peopleByName.get(item.assignee) : undefined;
      if (!assignee) issues.push(`${prefix}.assignee 不在演示员工池`);
      if (!text(item.role, 100) || (assignee && item.role !== assignee.jobTitle)) issues.push(`${prefix}.role 与执行人员岗位不一致`);
      if (typeof item.priority !== "string" || !priorities.has(item.priority as DispatchPriority)) issues.push(`${prefix}.priority 不合法`);
      if (!validDate(item.deadline)) issues.push(`${prefix}.deadline 必须是有效 YYYY-MM-DD 日期`);
      if (!Number.isInteger(item.estimated_hours) || Number(item.estimated_hours) < 1 || Number(item.estimated_hours) > 240) {
        issues.push(`${prefix}.estimated_hours 必须是 1 到 240 的整数`);
      }
      if (!textArray(item.dependencies, 8)) {
        issues.push(`${prefix}.dependencies 必须是文本数组`);
      } else {
        item.dependencies.forEach((dependency) => {
          if (!titles.includes(dependency) || dependency === item.title) {
            issues.push(`${prefix}.dependencies 包含不存在或自引用的任务`);
          }
        });
      }
      if (!text(item.reason, 400)) issues.push(`${prefix}.reason 不合法`);
    });
  }

  return issues.length
    ? { ok: false, issues }
    : { ok: true, plan: raw as AiDispatchPlan };
}
