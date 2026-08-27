import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { handleProjectMemberCommand } from "@/features/projects/project-commercial-command-handler";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string }> };

async function dependencies() {
  const session = await getWorkspaceSession();
  const client = await getSupabaseServerClient();
  return { session, rpc: async (name: string, args: Record<string, unknown>) => await client.rpc(name, args) };
}

export async function POST(request: Request, context: Context) {
  try { return await handleProjectMemberCommand(request, context, await dependencies(), "POST"); }
  catch { return Response.json({ error: "project_command_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}

export async function DELETE(request: Request, context: Context) {
  try { return await handleProjectMemberCommand(request, context, await dependencies(), "DELETE"); }
  catch { return Response.json({ error: "project_command_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
