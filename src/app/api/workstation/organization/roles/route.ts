import { getWorkspaceSession } from "@/features/auth/workspace-session";
import {
  handleOrganizationCommand,
  type OrganizationRpc,
} from "@/features/organization/organization-command-handler";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const client = await getSupabaseServerClient();
    const session = await getWorkspaceSession();
    const body: unknown = await request.clone().json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || (body as Record<string, unknown>).type !== "assign_member_role") {
      return Response.json(
        { error: "invalid_request" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const rpc: OrganizationRpc = async (functionName, args) => {
      return await client.rpc(functionName, args);
    };
    return handleOrganizationCommand(request, { session, rpc });
  } catch {
    return Response.json(
      { error: "server_misconfigured" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
