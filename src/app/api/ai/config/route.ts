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

async function authenticatedRequestContext(request: Request) {
  const client = await getSupabaseServerClient();
  const session = await getWorkspaceApiSession(request, client);
  return { client, session };
}

function isDemoSession(session: Awaited<ReturnType<typeof getWorkspaceApiSession>>) {
  return session?.identity.authProvider === "custom:demo";
}

export async function GET(request: Request) {
  try {
    const { session } = await authenticatedRequestContext(request);
    if (isDemoSession(session)) {
      return handleGetAiConfig({ session, store: { get: async () => null } });
    }
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
    const { client, session } = await authenticatedRequestContext(request);
    if (isDemoSession(session)) return Response.json(
      { error: "forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
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
