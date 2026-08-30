import { handleAiChat } from "@/features/ai-config/ai-chat-handler";
import { getAiConfigEnv } from "@/features/ai-config/ai-config-env";
import { createAiConfigStore } from "@/features/ai-config/ai-config-store";
import { handleConversationMessages } from "@/features/ai-assistant/conversation-handler";
import { createAiRuntimeStore } from "@/features/ai-runtime/rate-limit-store";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  return handleConversationMessages(request, (await params).conversationId);
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceRoleClient();
  const session = await getWorkspaceSession();
  return handleConversationMessages(request, (await params).conversationId, {
    loadSession: async () => session,
    rpc: async (name, args) => await client.rpc(name, args) as { data: unknown; error: { code?: string } | null },
    serviceRpc: async (name, args) => await service.rpc(name, args) as { data: unknown; error: { code?: string } | null },
    invoke: async (content, idempotencyKey) => {
      if (!session) return { success: false, content: "登录状态已失效，请重新登录。", errorCode: "unauthenticated" };
      const { encryptionKey } = getAiConfigEnv();
      const response = await handleAiChat(new Request("https://workstation.internal/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ messages: [{ role: "user", content }] }),
      }), { session, encryptionKey, store: createAiConfigStore(service), runtime: createAiRuntimeStore(service, session) });
      const payload: unknown = await response.json();
      const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      const choices = Array.isArray(data.choices) ? data.choices : [];
      const choice = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : null;
      const message = choice?.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : null;
      const answer = typeof message?.content === "string" ? message.content.trim() : "";
      return response.ok && answer ? { success: true, content: answer, errorCode: "" } : { success: false, content: "AI 服务暂时不可用，请稍后重试。", errorCode: typeof data.error === "string" ? data.error : "ai_provider_unavailable" };
    },
  });
}
