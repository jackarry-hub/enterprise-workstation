export type AiExecutionSummary = {
  completion: string;
  key_achievements: string[];
  team_performance: string;
  issues: string[];
  lessons: string[];
  next_steps: string[];
};

export type ExecutionSummaryInput = {
  goal: string;
  tasks: Array<{
    title: string;
    assignee: string;
    status: "done";
    submission: string;
    review_comment: string;
    rejection_count: number;
  }>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max = 1200): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function textArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 12 && value.every((item) => text(item, 600));
}

export function validateExecutionSummary(value: unknown):
  | { ok: true; summary: AiExecutionSummary }
  | { ok: false; issues: string[] } {
  const raw = record(value);
  if (!raw) return { ok: false, issues: ["返回内容不是 JSON 对象"] };
  const issues: string[] = [];
  if (!text(raw.completion)) issues.push("completion 必须是非空文本");
  if (!textArray(raw.key_achievements)) issues.push("key_achievements 必须是文本数组");
  if (!text(raw.team_performance)) issues.push("team_performance 必须是非空文本");
  if (!textArray(raw.issues)) issues.push("issues 必须是文本数组");
  if (!textArray(raw.lessons)) issues.push("lessons 必须是文本数组");
  if (!textArray(raw.next_steps)) issues.push("next_steps 必须是文本数组");
  return issues.length ? { ok: false, issues } : { ok: true, summary: raw as AiExecutionSummary };
}

export function validateExecutionSummaryInput(value: unknown):
  | { ok: true; execution: ExecutionSummaryInput }
  | { ok: false; issues: string[] } {
  const raw = record(value);
  if (!raw || !text(raw.goal, 300)) return { ok: false, issues: ["goal 必须是非空文本"] };
  if (!Array.isArray(raw.tasks) || raw.tasks.length < 1 || raw.tasks.length > 8) {
    return { ok: false, issues: ["tasks 必须包含 1 到 8 项已完成任务"] };
  }
  const valid = raw.tasks.every((value) => {
    const task = record(value);
    return task
      && text(task.title, 120)
      && text(task.assignee, 80)
      && task.status === "done"
      && text(task.submission, 1200)
      && text(task.review_comment, 600)
      && Number.isInteger(task.rejection_count)
      && Number(task.rejection_count) >= 0;
  });
  return valid
    ? { ok: true, execution: raw as ExecutionSummaryInput }
    : { ok: false, issues: ["任务执行数据不完整"] };
}
