import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { handleProjectRestoreCommand } from "@/features/projects/project-commercial-command-handler";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const session = await getWorkspaceSession();
    const client = await getSupabaseServerClient();
    return await handleProjectRestoreCommand(request, context, {
      session,
      rpc: async (name, args) => await client.rpc(name, args),
    });
  } catch {
    return Response.json({ error: "project_command_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
