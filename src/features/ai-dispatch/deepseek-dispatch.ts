import type {
  AiDispatchPlan,
  DemoTeamMemberContext,
} from "@/features/ai-dispatch/dispatch-contract";
import { validateDispatchPlan } from "@/features/ai-dispatch/dispatch-contract";

export const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_TIMEOUT_MS = 30_000;

export function normalizeDeepSeekModel(model?: string) {
  const configured = model?.trim();
  if (!configured || configured === "deepseek-chat") return DEFAULT_DEEPSEEK_MODEL;
  if (configured === "deepseek-reasoner") return "deepseek-v4-pro";
  return configured;
}

export const DEEPSEEK_DISPATCH_SYSTEM_PROMPT = `你是“AI企业大脑 · 企业中央调度官”。
你的任务不是聊天，而是把管理者输入的目标转换成可执行、可验收的企业任务计划。

必须完成：
1. 判断目标并提炼关键交付物；
2. 通常拆解为 6～8 个任务并明确依赖；仅在目标确实很小时允许 3～5 个；
3. 为每项任务从给定 Demo 员工池中选择负责人 owner 和执行人 assignee；owner 只能选择 canDispatch=true 的负责人或决策者；
4. assignee 的 role 必须使用其员工资料中的 jobTitle；
5. 根据员工技能、当前负荷和状态设置优先级、Deadline、工时和推荐理由；
6. 列出风险和管理者需要确认的事项；
7. 禁止生成员工池以外的姓名；
8. 不输出长篇分析，只输出一个 JSON 对象。
9. CEO 主要承担目标确认与最终决策，除非目标明确要求，不要把普通执行任务分配给 CEO。

JSON 字段必须严格为：
{
  "goal": "目标概述",
  "summary": "对目标的简短理解",
  "estimated_days": 3,
  "risk_level": "low | medium | high",
  "tasks": [{
    "title": "任务名称",
    "description": "任务说明",
    "owner": "演示员工姓名",
    "assignee": "演示员工姓名",
    "role": "assignee 的 jobTitle",
    "priority": "low | medium | high | urgent",
    "deadline": "YYYY-MM-DD",
    "estimated_hours": 8,
    "dependencies": ["前置任务标题"],
    "reason": "推荐理由"
  }],
  "risks": ["风险"],
  "manager_decisions": ["需要确认的事项"]
}`;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type DeepSeekDispatchErrorCode = "timeout" | "upstream" | "invalid_response";

export class DeepSeekDispatchError extends Error {
  constructor(
    public readonly code: DeepSeekDispatchErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DeepSeekDispatchError";
  }
}

type GenerateOptions = {
  command: string;
  apiKey: string;
  model?: string;
  team: readonly DemoTeamMemberContext[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: Date;
};

type DeepSeekResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
};

function shanghaiDate(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function commandContext(
  command: string,
  team: readonly DemoTeamMemberContext[],
  now: Date,
) {
  return JSON.stringify({
    command,
    current_date: shanghaiDate(now),
    timezone: "Asia/Shanghai",
    demo_team: team,
  });
}

function parseCandidate(content: string, team: readonly DemoTeamMemberContext[]) {
  const normalized = content.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return validateDispatchPlan(JSON.parse(normalized), team);
  } catch {
    return { ok: false as const, issues: ["返回内容不是有效 JSON"] };
  }
}

async function requestCompletion({
  apiKey,
  model,
  messages,
  fetchImpl,
  signal,
}: {
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  fetchImpl: FetchLike;
  signal: AbortSignal;
}) {
  const response = await fetchImpl(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.2,
      max_tokens: 6000,
      stream: false,
    }),
    signal,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json() as { error?: { message?: unknown } };
      detail = typeof payload.error?.message === "string"
        ? payload.error.message.trim().slice(0, 240)
        : "";
    } catch {
      // The status code still gives the route enough information for a safe message.
    }
    throw new DeepSeekDispatchError(
      "upstream",
      `DeepSeek API 返回 ${response.status}${detail ? `：${detail}` : ""}`,
      response.status,
    );
  }
  let payload: DeepSeekResponse;
  try {
    payload = await response.json() as DeepSeekResponse;
  } catch {
    throw new DeepSeekDispatchError("invalid_response", "DeepSeek 响应不是有效 JSON");
  }
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return { content: "", model: payload.model || model };
  }
  return { content, model: payload.model || model };
}

export async function generateDeepSeekDispatchPlan({
  command,
  apiKey,
  model = DEFAULT_DEEPSEEK_MODEL,
  team,
  fetchImpl = fetch,
  timeoutMs = DEEPSEEK_TIMEOUT_MS,
  now = new Date(),
}: GenerateOptions): Promise<{ plan: AiDispatchPlan; model: string; repaired: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const context = commandContext(command, team, now);
  const resolvedModel = normalizeDeepSeekModel(model);

  try {
    const first = await requestCompletion({
      apiKey,
      model: resolvedModel,
      fetchImpl,
      signal: controller.signal,
      messages: [
        { role: "system", content: DEEPSEEK_DISPATCH_SYSTEM_PROMPT },
        { role: "user", content: `请根据以下 JSON 上下文生成调度方案 JSON：\n${context}` },
      ],
    });
    const firstValidation = parseCandidate(first.content, team);
    if (firstValidation.ok) {
      return { plan: firstValidation.plan, model: first.model, repaired: false };
    }

    const repair = await requestCompletion({
      apiKey,
      model: resolvedModel,
      fetchImpl,
      signal: controller.signal,
      messages: [
        { role: "system", content: DEEPSEEK_DISPATCH_SYSTEM_PROMPT },
        { role: "user", content: `原始目标与员工上下文：\n${context}` },
        { role: "assistant", content: first.content || "（空响应）" },
        {
          role: "user",
          content: `请修复上一份 JSON。问题：${firstValidation.issues.join("；")}。只返回符合约定的完整 JSON 对象。`,
        },
      ],
    });
    const repairValidation = parseCandidate(repair.content, team);
    if (!repairValidation.ok) {
      throw new DeepSeekDispatchError("invalid_response", "DeepSeek 返回的调度方案格式不正确");
    }
    return { plan: repairValidation.plan, model: repair.model, repaired: true };
  } catch (error) {
    if (error instanceof DeepSeekDispatchError) throw error;
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new DeepSeekDispatchError("timeout", "DeepSeek 调度请求超时");
    }
    const causeCode = error instanceof Error
      ? (error as Error & { cause?: { code?: unknown } }).cause?.code
      : undefined;
    const suffix = typeof causeCode === "string" ? `（${causeCode}）` : "";
    throw new DeepSeekDispatchError("upstream", `服务器无法连接 DeepSeek API${suffix}`);
  } finally {
    clearTimeout(timeout);
  }
}
