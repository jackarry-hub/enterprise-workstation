import { createClient } from "@supabase/supabase-js";

import {
  handleGetAiConfig,
  handlePutAiConfig,
} from "@/features/ai-config/ai-config-handler";
import { getAiConfigEnv } from "@/features/ai-config/ai-config-env";
import { createAiConfigStore } from "@/features/ai-config/ai-config-store";
import { getWorkspaceApiSession } from "@/features/ai-config/workspace-api-session";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

async function dependencies(request: Request) {
  const session = await getWorkspaceApiSession(request);
  const { encryptionKey, supabaseServiceRoleKey } = getAiConfigEnv();
  const { url } = getSupabaseEnv();
  const admin = createClient(url, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    session,
    encryptionKey,
    store: createAiConfigStore(admin),
  };
}

export async function GET(request: Request) {
  try {
    return handleGetAiConfig(await dependencies(request));
  } catch {
    return serverError();
  }
}

export async function PUT(request: Request) {
  try {
    return handlePutAiConfig(request, await dependencies(request));
  } catch {
    return serverError();
  }
}

function serverError() {
  return Response.json(
    { error: "server_misconfigured" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
