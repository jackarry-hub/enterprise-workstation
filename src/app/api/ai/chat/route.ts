import { createClient } from "@supabase/supabase-js";

import { handleAiChat } from "@/features/ai-config/ai-chat-handler";
import { getAiConfigEnv } from "@/features/ai-config/ai-config-env";
import { createAiConfigStore } from "@/features/ai-config/ai-config-store";
import { getWorkspaceApiSession } from "@/features/ai-config/workspace-api-session";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getWorkspaceApiSession();
    const { encryptionKey, supabaseServiceRoleKey } = getAiConfigEnv();
    const { url } = getSupabaseEnv();
    const admin = createClient(url, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return handleAiChat(request, {
      session,
      encryptionKey,
      store: createAiConfigStore(admin),
    });
  } catch {
    return Response.json(
      { error: "server_misconfigured" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
