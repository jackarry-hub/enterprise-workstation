import { getDemoAuthEnv } from "@/features/demo-auth/demo-auth-env";
import { handleDemoSession } from "@/features/demo-auth/demo-auth-handler";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return handleDemoSession(request, getDemoAuthEnv());
  } catch {
    return Response.json(
      { error: "server_misconfigured" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
