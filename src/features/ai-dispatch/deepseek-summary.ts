import {
  DEEPSEEK_API_URL,
  DEEPSEEK_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_MODEL,
  DeepSeekDispatchError,
  normalizeDeepSeekModel,
} from "@/features/ai-dispatch/deepseek-dispatch";
import type { ExecutionSummaryInput } from "@/features/ai-dispatch/summary-contract";
import { validateExecutionSummary } from "@/features/ai-dispatch/summary-contract";

export const DEEPSEEK_SUMMARY_SYSTEM_PROMPT = `你是“AI企业大脑 · 企业执行复盘官”。
你的任务不是聊天，而是依据已验收的真实执行记录生成简洁、可行动的复盘总结。
不得虚构未提供的成果、人员或问题。只返回一个 JSON 对象：
{
  "completion": "目标完成情况",
  "key_achievements": ["关键成果"],
  "team_performance": "团队表现",
  "issues": ["执行问题"],
  "lessons": ["经验教训"],
  "next_steps": ["下一步建议"]
}`;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function completion({
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
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.2,
      max_tokens: 3000,
      stream: false,
    }),
    signal,
  });
  if (!response.ok) throw new DeepSeekDispatchError("upstream", `DeepSeek API 返回 ${response.status}`);
  const payload = await response.json() as { model?: string; choices?: Array<{ message?: { content?: string } }> };
  return { content: payload.choices?.[0]?.message?.content?.trim() ?? "", model: payload.model || model };
}

function parse(content: string) {
  const normalized = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return validateExecutionSummary(JSON.parse(normalized));
  } catch {
    return { ok: false as const, issues: ["返回内容不是有效 JSON"] };
  }
}

export async function generateDeepSeekExecutionSummary({
  execution,
  apiKey,
  model = DEFAULT_DEEPSEEK_MODEL,
  fetchImpl = fetch,
  timeoutMs = DEEPSEEK_TIMEOUT_MS,
}: {
  execution: ExecutionSummaryInput;
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const context = JSON.stringify(execution);
  const resolvedModel = normalizeDeepSeekModel(model);
  try {
    const first = await completion({
      apiKey,
      model: resolvedModel,
      fetchImpl,
      signal: controller.signal,
      messages: [
        { role: "system", content: DEEPSEEK_SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: `请根据以下已完成执行记录生成复盘 JSON：\n${context}` },
      ],
    });
    const firstValidation = parse(first.content);
    if (firstValidation.ok) return { summary: firstValidation.summary, model: first.model, repaired: false };
    const repaired = await completion({
      apiKey,
      model: resolvedModel,
      fetchImpl,
      signal: controller.signal,
      messages: [
        { role: "system", content: DEEPSEEK_SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: context },
        { role: "assistant", content: first.content || "（空响应）" },
        { role: "user", content: `请修复 JSON：${firstValidation.issues.join("；")}。只返回完整 JSON 对象。` },
      ],
    });
    const repairValidation = parse(repaired.content);
    if (!repairValidation.ok) throw new DeepSeekDispatchError("invalid_response", "DeepSeek 返回的执行总结格式不正确");
    return { summary: repairValidation.summary, model: repaired.model, repaired: true };
  } catch (error) {
    if (error instanceof DeepSeekDispatchError) throw error;
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new DeepSeekDispatchError("timeout", "DeepSeek 总结请求超时");
    }
    throw new DeepSeekDispatchError("upstream", "DeepSeek 总结服务暂时不可用");
  } finally {
    clearTimeout(timeout);
  }
}
