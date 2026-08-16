import { buildDemoTeamContext } from "@/features/ai-dispatch/demo-team-context";
import { createDemoFallbackDispatchPlan } from "@/features/ai-dispatch/demo-fallback-plan";
import {
  DeepSeekDispatchError,
  generateDeepSeekDispatchPlan,
} from "@/features/ai-dispatch/deepseek-dispatch";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { isCustomerDemoMode } from "@/features/demo/customer-demo-mode";

type DispatchRouteDependencies = {
  env?: Record<string, string | undefined>;
  getSession?: typeof getWorkspaceSession;
  generate?: typeof generateDeepSeekDispatchPlan;
};

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export function createDispatchPost({
  env = process.env,
  getSession,
  generate = generateDeepSeekDispatchPlan,
}: DispatchRouteDependencies = {}) {
  return async function POST(request: Request) {
    const demoMode = isCustomerDemoMode(env);
    let session;
    try {
      session = getSession
        ? await getSession()
        : demoMode
          ? customerDemoSessions[0]
          : await getWorkspaceSession();
    } catch {
      return errorResponse(503, "auth_unavailable", "暂时无法验证工作身份，请稍后重试。");
    }
    if (!session) return errorResponse(401, "unauthorized", "请先登录后使用AI调度服务。");

    const canDispatch = ["executive", "department_head", "finance", "hr"]
      .includes(session.primaryRole);
    if (!canDispatch) return errorResponse(403, "forbidden", "当前身份没有AI调度权限。");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "invalid_request", "请输入需要推进的目标。");
    }
    const command = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).command
      : undefined;
    if (typeof command !== "string" || !command.trim() || command.trim().length > 1000) {
      return errorResponse(400, "invalid_request", "请输入1到1000字的有效目标。");
    }

    const apiKey = env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      if (demoMode) {
        return Response.json({
          plan: createDemoFallbackDispatchPlan(command.trim(), buildDemoTeamContext()),
          model: "demo-fallback",
          repaired: false,
          mode: "demo" as const,
          source: "demo_fallback" as const,
        });
      }
      return errorResponse(503, "ai_not_configured", "AI调度服务尚未配置，请联系管理员。");
    }

    try {
      const result = await generate({
        command: command.trim(),
        apiKey,
        model: env.DEEPSEEK_MODEL?.trim() || undefined,
        team: buildDemoTeamContext(),
      });
      return Response.json({ ...result, mode: "demo" as const, source: "deepseek" as const });
    } catch (error) {
      if (error instanceof DeepSeekDispatchError) {
        if (demoMode && (error.code === "upstream" || error.code === "timeout")) {
          return Response.json({
            plan: createDemoFallbackDispatchPlan(command.trim(), buildDemoTeamContext()),
            model: "demo-fallback",
            repaired: false,
            mode: "demo" as const,
            source: "demo_fallback" as const,
          });
        }
        if (error.code === "timeout") {
          return errorResponse(504, "ai_timeout", "AI调度服务响应超时，请重新生成。");
        }
        if (error.code === "invalid_response") {
          return errorResponse(502, "ai_invalid_response", "AI生成结果暂时无法解析，请重新生成。");
        }
        if (error.status === 401 || error.status === 403) {
          return errorResponse(503, "ai_auth_failed", "DeepSeek API 密钥无效或无权限，请检查服务端配置。");
        }
        if (error.status === 402) {
          return errorResponse(503, "ai_balance_required", "DeepSeek 账户余额不足，请充值后重试。");
        }
        if (error.status === 400 || error.status === 422) {
          return errorResponse(502, "ai_invalid_configuration", `DeepSeek 模型或请求参数不兼容：${error.message}`);
        }
        if (error.status === 429) {
          return errorResponse(503, "ai_rate_limited", "DeepSeek 请求过于频繁，请稍后重试。");
        }
        return errorResponse(503, "ai_unavailable", error.message);
      }
      return errorResponse(503, "ai_unavailable", "AI调度服务暂时不可用，请稍后重试。");
    }
  };
}
