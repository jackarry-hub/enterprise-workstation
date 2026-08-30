import { randomUUID } from "node:crypto";

import { handleAiChat } from "@/features/ai-config/ai-chat-handler";
import { getAiConfigEnv } from "@/features/ai-config/ai-config-env";
import { createAiConfigStore } from "@/features/ai-config/ai-config-store";
import { createAiRuntimeStore } from "@/features/ai-runtime/rate-limit-store";
import { handleSchedulingPlans } from "@/features/ai-scheduler/scheduling-handler";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await getWorkspaceSession(); const client = await getSupabaseServerClient(); const service = getSupabaseServiceRoleClient();
  return handleSchedulingPlans(request, (await params).goalId, {
    loadSession: async () => session,
    rpc: async (name, args) => await client.rpc(name, args) as { data: unknown; error: { code?: string } | null },
    serviceRpc: async (name, args) => await service.rpc(name, args) as { data: unknown; error: { code?: string } | null },
    generateModel: async (evidence) => {
      if (!session) throw new Error("unauthenticated");
      const key = request.headers.get("idempotency-key") ?? randomUUID(); const { encryptionKey } = getAiConfigEnv();
      const rawMembers = Array.isArray(evidence.members) ? evidence.members : [];
      const providerEvidence = { goal: evidence.goal, project: evidence.project, members: rawMembers.map((item) => {
        const member = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
        return { memberId: member.memberId, skills: member.skills, allocationPercent: member.allocationPercent, openTaskCount: member.openTaskCount, taskIds: member.taskIds };
      }) };
      const response = await handleAiChat(new Request("https://workstation.internal/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ structured_output: true, max_tokens: 3000, messages: [{ role: "user", content: `仅输出 JSON：{\"assignments\":[{\"memberId\":数字,\"title\":\"任务\",\"description\":\"说明\",\"acceptanceCriteria\":\"验收\",\"dueDate\":\"YYYY-MM-DD\",\"priority\":\"medium\",\"estimatedHours\":8,\"requiredSkills\":[\"skill\"]}]}。只能使用以下真实项目证据：${JSON.stringify(providerEvidence)}` }] }) }), { session, encryptionKey, store: createAiConfigStore(service), runtime: createAiRuntimeStore(service, session) });
      if (!response.ok) throw new Error("model_failed");
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return JSON.parse(payload.choices?.[0]?.message?.content ?? "null") as unknown;
    },
  });
}
