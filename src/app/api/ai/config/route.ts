import {
  handleGetAiConfig,
  handlePutAiConfig,
} from "@/features/ai-config/ai-config-handler";
import { getAiConfigEnv } from "@/features/ai-config/ai-config-env";
import { createAiConfigStore } from "@/features/ai-config/ai-config-store";
import { getWorkspaceApiSession } from "@/features/ai-config/workspace-api-session";
import {
  getSupabaseServerClient,
  getSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function authenticatedRequestContext() {
  const client = await getSupabaseServerClient();
  const session = await getWorkspaceApiSession(undefined, client);
  return { client, session };
}

export async function GET() {
  try {
    const { session } = await authenticatedRequestContext();
    // The configuration table remains server-only; this read is immediately
    // sanitized by the handler and is never used for a command.
    return handleGetAiConfig({
      session,
      store: createAiConfigStore(getSupabaseServiceRoleClient()),
    });
  } catch {
    return serverError();
  }
}

export async function PUT(request: Request) {
  try {
    const { client, session } = await authenticatedRequestContext();
    const { encryptionKey } = getAiConfigEnv();
    return handlePutAiConfig(request, {
      session,
      encryptionKey,
      store: createAiConfigStore(client),
    });
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
