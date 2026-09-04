import { randomUUID } from "node:crypto";

import { handleAiChat } from "@/features/ai-config/ai-chat-handler";
import { getAiConfigEnv } from "@/features/ai-config/ai-config-env";
import { createAiConfigStore } from "@/features/ai-config/ai-config-store";
import { createAiRuntimeStore } from "@/features/ai-runtime/rate-limit-store";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { handleDecisionPlan } from "@/features/decisions/decision-handler";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ commandId: string }> };
export async function PATCH(request: Request, { params }: Context) { return handleDecisionPlan(request, (await params).commandId); }
export async function POST(request: Request, { params }: Context) {
  const session = await getWorkspaceSession(); const client = await getSupabaseServerClient(); const service = getSupabaseServiceRoleClient();
  return handleDecisionPlan(request, (await params).commandId, {
    loadSession: async () => session,
    rpc: async (name, args) => await client.rpc(name, args) as { data: unknown; error: { code?: string } | null },
    serviceRpc: async (name, args) => await service.rpc(name, args) as { data: unknown; error: { code?: string } | null },
    generatePlan: async (evidence) => {
      if (!session) throw new Error("unauthenticated"); const requestId = request.headers.get("idempotency-key") ?? randomUUID(); const { encryptionKey } = getAiConfigEnv();
      const prompt = `你是企业任务拆解 Agent。只能依据提供的真实成员和指令，输出一个 JSON 对象，不得调用工具或虚构员工。格式：{"understanding":"指令理解","executionGoal":"可验收目标","project":{"name":"项目名","description":"说明"},"milestones":[{"key":"m1","name":"里程碑","description":"说明","dueDate":"YYYY-MM-DD"}],"tasks":[{"key":"t1","milestoneKey":"m1","title":"任务","description":"执行说明","acceptanceCriteria":"明确验收标准","dueDate":"YYYY-MM-DD","priority":"medium","assigneeMemberId":数字,"estimatedHours":8,"dependencies":[]}],"risks":["风险"]}。每个任务必须有真实 assigneeMemberId、截止日、验收标准，依赖只能引用 tasks.key。证据：${JSON.stringify(evidence)}`;
      const result = await handleAiChat(new Request("https://workstation.internal/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId }, body: JSON.stringify({ structured_output: true, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }) }), { session, encryptionKey, store: createAiConfigStore(service), runtime: createAiRuntimeStore(service, session) });
      if (!result.ok) throw new Error("model_failed"); const payload = await result.json() as { choices?: Array<{ message?: { content?: string } }> }; return JSON.parse(payload.choices?.[0]?.message?.content ?? "null") as unknown;
    },
  });
}
