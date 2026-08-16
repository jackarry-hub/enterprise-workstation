import { DeepSeekDispatchError } from "@/features/ai-dispatch/deepseek-dispatch";
import { generateDeepSeekExecutionSummary } from "@/features/ai-dispatch/deepseek-summary";
import { validateExecutionSummaryInput } from "@/features/ai-dispatch/summary-contract";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { isCustomerDemoMode } from "@/features/demo/customer-demo-mode";

type Dependencies = {
  env?: Record<string, string | undefined>;
  getSession?: typeof getWorkspaceSession;
  generate?: typeof generateDeepSeekExecutionSummary;
};

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export function createSummaryPost({
  env = process.env,
  getSession,
  generate = generateDeepSeekExecutionSummary,
}: Dependencies = {}) {
  return async function POST(request: Request) {
    let session;
    try {
      session = getSession
        ? await getSession()
        : isCustomerDemoMode(env)
          ? customerDemoSessions[0]
          : await getWorkspaceSession();
    } catch {
      return errorResponse(503, "auth_unavailable", "暂时无法验证工作身份，请稍后重试。");
    }
    if (!session) return errorResponse(401, "unauthorized", "请先登录后生成 AI 总结。");
    if (!["executive", "department_head", "finance", "hr"].includes(session.primaryRole)) {
      return errorResponse(403, "forbidden", "当前身份没有 AI 总结权限。");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "invalid_request", "执行记录格式不正确。");
    }
    const execution = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).execution
      : undefined;
    const validation = validateExecutionSummaryInput(execution);
    if (!validation.ok) return errorResponse(400, "invalid_request", validation.issues.join("；"));

    const apiKey = env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) return errorResponse(503, "ai_not_configured", "AI总结服务尚未配置，请联系管理员。");

    try {
      const result = await generate({
        execution: validation.execution,
        apiKey,
        model: env.DEEPSEEK_MODEL?.trim() || undefined,
      });
      return Response.json({ ...result, mode: "demo" as const });
    } catch (error) {
      if (error instanceof DeepSeekDispatchError) {
        if (error.code === "timeout") return errorResponse(504, "ai_timeout", "AI总结服务响应超时，请重试。");
        if (error.code === "invalid_response") return errorResponse(502, "ai_invalid_response", "AI总结暂时无法解析，请重试。");
      }
      return errorResponse(503, "ai_unavailable", "AI总结服务暂时不可用，请稍后重试。");
    }
  };
}
